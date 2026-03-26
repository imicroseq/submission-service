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

import { ACTIVE_SUBMISSION_STATUS, BATCH_ERROR_TYPE, type BatchError, type Schema } from '@overture-stack/lyric';

import { env } from '@/common/envConfig.js';
import logger from '@/common/logger.js';
import { lyricProvider } from '@/core/provider.js';
import { type InsertSubmissionFile } from '@/db/schemas/index.js';
import { getAnalysisFilesByAnalysisId, submit as songSubmit } from '@/submission/song.js';
import type { SequencingMetadataType, SubmissionManifest } from '@/submission/submitRequest.js';

import { getDbInstance } from '../db/index.js';
import { fileRepository } from '../repository/fileRepository.js';
import { buildFileMetadata, buildSequencingFilesMetadata } from './fileValidation.js';
import { convertRecordToPayload, prefixKeys } from './populateTemplate.js';
import { parseFileToRecords } from './readFile.js';

interface SuccessSubmissionResult {
	success: true;
	submissionId: number;
	submissionManifest?: SubmissionManifest[];
}

interface ErrorSubmissionResult {
	success: false;
	submissionId?: number;
	errors: BatchError[];
}

// This template is used to convert the sequencing metadata into a payload to Song
const SEQUENCING_TEMPLATE = 'sequencing_payload.json' as const;
const DATA_PREFIX = 'data.' as const;

/**
 * Builds the Song payload based on the Sequencing files Metadata
 * @param param0
 * @returns
 */
const buildSongSubmissionPayload = ({
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
 * Constructs an array of data to be used for the file Manifest
 * @param analysisIds
 * @param organization
 * @returns
 */
const buildSubmissionManifest = async (analysisIds: string[], organization: string): Promise<SubmissionManifest[]> => {
	const manifest: SubmissionManifest[] = [];
	for (const analysisId of analysisIds) {
		const result = await getAnalysisFilesByAnalysisId(organization, analysisId);
		manifest.push(
			...result.map<SubmissionManifest>((file) => ({
				objectId: file.objectId,
				fileName: file.fileName,
				md5Sum: file.fileMd5sum,
			})),
		);
	}
	return manifest;
};

/**
 * This function handles the Song Submission and stores the result
 * @param songSubmissionData
 * @param organization
 * @param submissionId
 * @param fileNameIdentifier
 * @param submissionFile
 * @returns
 */
const submitSongPayload = async (
	songSubmissionData: Record<string, any>[],
	organization: string,
	submissionId: number,
	fileNameIdentifier: string,
	submissionFile: Express.Multer.File,
): Promise<{ success: true; analysisIds: string[] } | ErrorSubmissionResult> => {
	const db = getDbInstance();
	const fileRepo = fileRepository(db);
	const insertSubmissionFiles: InsertSubmissionFile[] = [];

	const songErrors: BatchError[] = [];
	const songAnalysIds: string[] = [];

	for (const record of songSubmissionData) {
		try {
			// Song submission accepts only 1 record per call
			const result = await songSubmit(organization, record);
			songAnalysIds.push(result.analysisId);
			insertSubmissionFiles.push({
				analysis_id: result.analysisId,
				submission_id: submissionId,
				record_identifier: record[fileNameIdentifier],
			});
		} catch (error) {
			songErrors.push({
				message: error?.toString() || 'Unknown error',
				type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
				batchName: submissionFile.originalname,
			});
		}
	}

	logger.info(`'${songAnalysIds.length}' sequencing files successfully submitted to Song`);

	if (songErrors.length > 0) {
		logger.error(`'${songErrors.length}' sequencing files failed submitting to Song`);
		// Lyric submission was successful, but song submission failed
		// Should we cancel the submission?
		return {
			success: false,
			submissionId,
			errors: songErrors,
		};
	}

	try {
		fileRepo.saveSubmissionFiles(insertSubmissionFiles);
	} catch (error) {
		logger.error(error, 'An error ocurring storing submission files mapping.');
		// Lyric submission + Song Submission was successful, but storing submission files mapping failed
		// Should we cancel the submission?
		return {
			success: false,
			submissionId,
			errors: [
				{
					message: error?.toString() || 'Unknown error',
					type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
					batchName: submissionFile.originalname,
				},
			],
		};
	}

	return { success: true, analysisIds: songAnalysIds };
};

/**
 * Handles the submission of a file and its associated metadata
 * Parses, validates and submit the Submission file and sequencing metadata if present
 * @param param0
 * @returns
 */
export async function handleSubmission({
	submissionFile,
	sequencingMetadataValues,
	organization,
	entityName,
	categoryId,
	username,
	schema,
}: {
	submissionFile: Express.Multer.File;
	sequencingMetadataValues: SequencingMetadataType[] | null;
	organization: string;
	entityName: string;
	categoryId: number;
	username: string;
	schema: Schema;
}): Promise<SuccessSubmissionResult | ErrorSubmissionResult> {
	const fileNameIdentifier = env.SEQUENCING_SUBMISSION_FILENAME_IDENTIFIER_COLUMN || '';
	const sequencingEnabled = env.SEQUENCING_SUBMISSION_ENABLED;

	const extractedData = await parseFileToRecords(submissionFile, schema);

	const songSubmissionData: Record<string, any>[] = [];

	// Build Sequencing metadata
	if (sequencingMetadataValues) {
		const { errors, validFiles: sequencingFilesMetadata } = buildSequencingFilesMetadata(
			sequencingMetadataValues,
			extractedData,
			submissionFile.originalname,
		);

		if (errors.length > 0) {
			logger.info(`Error validation sequencing file metadata: ${JSON.stringify(errors)}`);
			return {
				success: false,
				errors,
			};
		}

		// Convert Sequencing metadata to payload
		if (fileNameIdentifier && sequencingEnabled) {
			const resultSongPayload = buildSongSubmissionPayload({
				sequencingFilesMetadata,
				extractedData,
				organization,
				fileNameIdentifier,
			});
			songSubmissionData.push(...resultSongPayload);
		}
	}

	// Lyric Submission
	const lyricSubmitResult = await lyricProvider.services.submission.submit({
		data: { [entityName]: extractedData },
		categoryId,
		organization,
		username,
	});

	if (lyricSubmitResult.status !== ACTIVE_SUBMISSION_STATUS.PROCESSING || !lyricSubmitResult.submissionId) {
		return {
			success: false,
			errors: [
				{
					message: lyricSubmitResult.description,
					type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
					batchName: submissionFile.originalname,
				},
			],
		};
	}

	if (!sequencingEnabled || !songSubmissionData.length) {
		return { success: true, submissionId: lyricSubmitResult.submissionId };
	}

	const songSubmissionResult = await submitSongPayload(
		songSubmissionData,
		organization,
		lyricSubmitResult.submissionId,
		fileNameIdentifier,
		submissionFile,
	);

	if (!songSubmissionResult.success) {
		logger.info(`Song submission failed. Cancelling active submission ID '${lyricSubmitResult.submissionId}}'`);
		await lyricProvider.services.submission.deleteActiveSubmissionById(lyricSubmitResult.submissionId, username, false);

		return songSubmissionResult;
	}

	// Build the manifest data to be included in the response
	const manifest: SubmissionManifest[] = [];
	if (songSubmissionResult.analysisIds.length) {
		const songManifest = await buildSubmissionManifest(songSubmissionResult.analysisIds, organization);
		manifest.push(...songManifest);
	}

	// Successful submission!
	return {
		success: true,
		submissionId: lyricSubmitResult.submissionId,
		submissionManifest: manifest,
	};
}
