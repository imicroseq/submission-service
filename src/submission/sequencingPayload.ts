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

import type { SequencingMetadataType } from '@/submission/submitRequest.js';

import { buildFileMetadata } from './fileValidation.js';
import { convertRecordToPayload, prefixKeys } from './populateTemplate.js';

// This template is used to convert the sequencing metadata into a payload to Song
const SEQUENCING_TEMPLATE = 'sequencing_payload.json' as const;
const DATA_PREFIX = 'data.' as const;

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
}): Record<string, any>[] => {
	const songSubmissionData: Record<string, any>[] = [];
	// Convert Sequencing metadata to payload
	for (const filesMetadata of sequencingFilesMetadata) {
		const matchedRecord = extractedData.find((record) => record[fileNameIdentifier] === filesMetadata.identifier);

		if (!matchedRecord) {
			continue;
		}

		const prefixedRecord = prefixKeys(matchedRecord, DATA_PREFIX);
		const songPayload = convertRecordToPayload({ organization, ...prefixedRecord }, SEQUENCING_TEMPLATE);
		// TODO: Handle multiple files by same identifier
		songPayload.files = [buildFileMetadata(filesMetadata)];

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
