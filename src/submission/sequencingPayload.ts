/*
 * Copyright (c) 2025 The Ontario Institute for Cancer Research. All rights reserved
 *
 * This program and the accompanying materials are made available under the terms of
 * the GNU Affero General Public License v3.0. You should have received a copy of the
 * GNU Affero General Public License along with this program.
 *  If not, see <http://www.gnu.org/licenses/>.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
 * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { BATCH_ERROR_TYPE, type BatchError } from '@overture-stack/lyric';

import type { SelectSubmissionFile } from '@/db/schemas/record_analysis_map.js';
import type { SequencingMetadataType } from '@/submission/submitRequest.js';

import { buildFileMetadata } from './fileValidation.js';
import { convertRecordToPayload, prefixKeys } from './populateTemplate.js';

// This template is used to convert the sequencing metadata into a payload to Song
const SEQUENCING_TEMPLATE = 'sequencing_payload.json' as const;
const DATA_PREFIX = 'data.' as const;

export type SongSubmissionPayload = Record<string, any> & {
	files: SequencingMetadataType[];
};

/**
 * Returns metadata entries whose MD5 sum occurs more than once in the input.
 * If the MD5 sum is empty, it is ignored and not considered a duplicate.
 */
export const findDuplicateSequencingMetadata = (
	sequencingMetadataValues: SequencingMetadataType[],
): SequencingMetadataType[] => {
	const metadataWithMd5sums = sequencingMetadataValues.filter(({ fileMd5sum }) => Boolean(fileMd5sum));
	const md5sumCounts = metadataWithMd5sums.reduce((counts, metadata) => {
		const normalizedMd5sum = metadata.fileMd5sum.toLowerCase();
		return counts.set(normalizedMd5sum, (counts.get(normalizedMd5sum) ?? 0) + 1);
	}, new Map<string, number>());

	return metadataWithMd5sums.filter((metadata) => (md5sumCounts.get(metadata.fileMd5sum.toLowerCase()) ?? 0) > 1);
};

/**
 * Returns sequencing metadata whose MD5 sum is already present in submitted files.
 * If the MD5 sum is empty, it is ignored and not considered a duplicate.
 */
export const findAlreadySubmittedFiles = (
	existingFiles: SelectSubmissionFile[],
	sequencingMetadataValues: SequencingMetadataType[],
): SequencingMetadataType[] => {
	const existingMd5Sums = new Set(existingFiles.flatMap(({ md5_sum }) => (md5_sum ? [md5_sum.toLowerCase()] : [])));

	return sequencingMetadataValues.filter((metadata) => existingMd5Sums.has(metadata.fileMd5sum.toLowerCase()));
};

/**
 * Returns a BatchError if there are duplicate sequencing metadata entries, otherwise returns undefined.
 * @param sequencingMetadataValues - The sequencing metadata values to check for duplicates
 * @param batchName - The name of the batch, used in the error message if duplicates are found
 * @returns A BatchError if duplicates are found, otherwise undefined
 */
export const getDuplicateSequencingMetadataError = (
	sequencingMetadataValues: SequencingMetadataType[],
	batchName?: string,
): BatchError | undefined => {
	const duplicateMetadataFiles = findDuplicateSequencingMetadata(sequencingMetadataValues);
	if (!duplicateMetadataFiles.length) {
		return undefined;
	}

	return {
		message: `The following files have duplicate md5sum values: ${duplicateMetadataFiles.map((metadata) => metadata.fileName).join(', ')}`,
		type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
		batchName: batchName || '',
	};
};

/**
 * Returns a BatchError if there are already submitted files, otherwise returns undefined.
 * @param existingFiles - The existing submitted files to check against
 * @param sequencingMetadataValues - The sequencing metadata values to check for already submitted files
 * @param batchName - The name of the batch, used in the error message if already submitted files are found
 * @returns A BatchError if already submitted files are found, otherwise undefined
 */
export const getAlreadySubmittedFilesError = (
	existingFiles: SelectSubmissionFile[],
	sequencingMetadataValues: SequencingMetadataType[],
	batchName?: string,
): BatchError | undefined => {
	const alreadySubmittedFiles = findAlreadySubmittedFiles(existingFiles, sequencingMetadataValues);
	if (!alreadySubmittedFiles.length) {
		return undefined;
	}

	return {
		message: `The following files have already been submitted for this submission: ${alreadySubmittedFiles.map((file) => file.fileName).join(', ')}`,
		type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
		batchName: batchName || '',
	};
};

/**
 * Builds the Song payload based on the Sequencing files Metadata
 * @param param0
 * @returns
 */
export const buildSongSubmissionPayload = ({
	sequencingFilesMetadata,
	extractedData,
	organization,
	fileNameIdentifier,
}: {
	sequencingFilesMetadata: (SequencingMetadataType & { identifier: string })[];
	extractedData: Record<string, string>[];
	organization: string;
	fileNameIdentifier: string;
}): SongSubmissionPayload[] => {
	const songSubmissionData: SongSubmissionPayload[] = [];
	// Convert Sequencing metadata to payload
	for (const filesMetadata of sequencingFilesMetadata) {
		const matchedRecord = extractedData.find((record) => record[fileNameIdentifier] === filesMetadata.identifier);

		if (!matchedRecord) {
			continue;
		}

		const prefixedRecord = prefixKeys(matchedRecord, DATA_PREFIX);
		// TODO: Handle multiple files by same identifier
		const songPayload: SongSubmissionPayload = {
			...convertRecordToPayload({ organization, ...prefixedRecord }, SEQUENCING_TEMPLATE),
			files: [buildFileMetadata(filesMetadata)], // Only 1s sequencing file per record is expected, but we can extend this in the future if needed
		};

		songSubmissionData.push(songPayload);
	}
	return songSubmissionData;
};

/**
 * Flattens Submission Data records down to their INSERTS, converting field values to strings so
 * they can be matched against sequencing file metadata by `buildSequencingFilesMetadata`.
 * @param submissionRecords
 * @returns
 */
export const extractInsertRecordValues = (
	submissionRecords: { type: string; value: Record<string, unknown> }[],
): Record<string, string>[] =>
	submissionRecords
		.filter((record) => record.type === 'INSERTS')
		.map((record) =>
			Object.fromEntries(Object.entries(record.value).map(([key, value]) => [key, String(value ?? '')])),
		);
