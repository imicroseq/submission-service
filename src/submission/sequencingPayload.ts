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
import { getIdentifierFromFileName } from '@/utils/file.js';

import { buildFileMetadata } from './fileValidation.js';
import { convertRecordToPayload, prefixKeys } from './populateTemplate.js';

// This template is used to convert the sequencing metadata into a payload to Song
const SEQUENCING_TEMPLATE = 'sequencing_payload.json' as const;
const DATA_PREFIX = 'data.' as const;

export type SongSubmissionPayload = Record<string, any> & {
	files: SequencingMetadataType[];
};

/**
 * Returns metadata entries whose file identifier occurs more than once in the input.
 */
export const findDuplicateInputRecordIdentifier = (
	sequencingMetadataValues: SequencingMetadataType[],
): SequencingMetadataType[] => {
	const metadataWithIdentifiers = sequencingMetadataValues.map((metadata) => ({
		metadata,
		identifier: getIdentifierFromFileName(metadata.fileName),
	}));
	const identifierCounts = metadataWithIdentifiers.reduce((counts, { identifier }) => {
		return counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
	}, new Map<string, number>());

	return metadataWithIdentifiers
		.filter(({ identifier }) => (identifierCounts.get(identifier) ?? 0) > 1)
		.map(({ metadata }) => metadata);
};

/**
 * Returns metadata entries whose file MD5 sum occurs more than once in the input.
 */
export const findDuplicateInputMd5sum = (
	sequencingMetadataValues: SequencingMetadataType[],
): SequencingMetadataType[] => {
	const md5sumCounts = sequencingMetadataValues
		.filter((metadata) => metadata.fileMd5sum)
		.reduce((counts, metadata) => {
			if (metadata.fileMd5sum) {
				return counts.set(metadata.fileMd5sum, (counts.get(metadata.fileMd5sum) ?? 0) + 1);
			}
			return counts;
		}, new Map<string, number>());

	return sequencingMetadataValues.filter(
		(metadata) => metadata.fileMd5sum && (md5sumCounts.get(metadata.fileMd5sum) ?? 0) > 1,
	);
};

/**
 * Returns sequencing metadata whose Record identifier is already present in submitted files.
 */
export const findSubmittedDuplicateRecordIdentifiers = (
	existingFiles: SelectSubmissionFile[],
	sequencingMetadataValues: SequencingMetadataType[],
): SequencingMetadataType[] => {
	const existingIdentifiers = new Set(
		existingFiles.flatMap(({ record_identifier }) => (record_identifier ? [record_identifier.toLowerCase()] : [])),
	);

	return sequencingMetadataValues.filter((metadata) => {
		const identifier = getIdentifierFromFileName(metadata.fileName).toLowerCase();
		return existingIdentifiers.has(identifier);
	});
};

export const findSubmittedDuplicateMd5sums = (
	existingFiles: SelectSubmissionFile[],
	sequencingMetadataValues: SequencingMetadataType[],
): SequencingMetadataType[] => {
	const existingMd5sums = new Set(existingFiles.flatMap(({ md5_sum }) => (md5_sum ? [md5_sum] : [])));

	return sequencingMetadataValues.filter((metadata) => {
		return metadata.fileMd5sum && existingMd5sums.has(metadata.fileMd5sum);
	});
};

/**
 * Returns a BatchError if sequencing metadata files have already been submitted for the same Record identifier.
 * @param existingFiles - The existing submitted files
 * @param sequencingMetadataValues - The user input Request of new sequencing metadata values
 * @param batchName - The name of the batch, used in the error message if already submitted files are found
 * @returns A BatchError if already submitted files are found, otherwise undefined
 */
export const getDuplicateRecordIdentifierInSubmissionError = (
	existingFiles: SelectSubmissionFile[],
	sequencingMetadataValues: SequencingMetadataType[],
	batchName?: string,
): BatchError[] => {
	const errors: BatchError[] = [];

	// User input request check for duplicate identifiers in the same request
	const duplicateIdentifiers = findDuplicateInputRecordIdentifier(sequencingMetadataValues);
	if (duplicateIdentifiers.length) {
		errors.push({
			message: `The following files have duplicate identifier values: ${duplicateIdentifiers.map((metadata) => metadata.fileName).join(', ')}`,
			type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
			batchName: batchName || '',
		});
	}

	// Check for duplicate identifiers in the existing submitted files
	const foundDuplicates = findSubmittedDuplicateRecordIdentifiers(existingFiles, sequencingMetadataValues);
	if (foundDuplicates.length) {
		errors.push({
			message: `The following files have already been submitted for this submission: ${foundDuplicates.map((file) => file.fileName).join(', ')}`,
			type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
			batchName: batchName || '',
		});
	}

	return errors;
};

/**
 * Returns a BatchError if sequencing metadata files have already been committed with the same MD5 sum.
 * @param existingFiles - The existing committed files with matching MD5 sums
 * @param sequencingMetadataValues - The sequencing metadata values to check against existing files
 * @param batchName - The name of the batch, used in the error message
 * @returns A BatchError if duplicate MD5 sums are found, otherwise undefined
 */
export const getDuplicateFileMd5sumError = (
	existingFiles: SelectSubmissionFile[],
	sequencingMetadataValues: SequencingMetadataType[],
	batchName?: string,
): BatchError[] => {
	const errors: BatchError[] = [];

	// User input request check for duplicate MD5 sums in the same request
	const duplicateMd5sums = findDuplicateInputMd5sum(sequencingMetadataValues);

	if (duplicateMd5sums.length) {
		errors.push({
			message: `The following files have duplicate MD5 sums: ${duplicateMd5sums.map((metadata) => metadata.fileName).join(', ')}`,
			type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
			batchName: batchName || '',
		});
	}

	// Check for duplicate MD5 sums in the existing submitted files
	const duplicatedFiles = findSubmittedDuplicateMd5sums(existingFiles, sequencingMetadataValues);

	if (duplicatedFiles.length) {
		errors.push({
			message: `The following files have duplicate MD5 sums: ${duplicatedFiles.map((metadata) => metadata.fileName).join(', ')}`,
			type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
			batchName: batchName || '',
		});
	}

	return errors;
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
