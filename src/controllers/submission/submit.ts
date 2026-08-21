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

import { type Response } from 'express';

import { ACTIVE_SUBMISSION_STATUS, type BatchError, type SubmissionSummary } from '@overture-stack/lyric';

import { hasUserWriteAccess, shouldBypassAuth } from '@/common/auth.js';
import logger from '@/common/logger.js';
import { lyricProvider } from '@/core/provider.js';
import { validateRequest } from '@/middleware/requestValidation.js';
import { fetchSubmissionFilesBySubmissionId } from '@/service/fileService.js';
import { prevalidateNewDataFile } from '@/submission/fileValidation.js';
import { getAlreadySubmittedFilesError, getDuplicateSequencingMetadataError } from '@/submission/sequencingPayload.js';
import { handleSequencingMetadataSubmission, handleSubmission } from '@/submission/submissionHandler.js';
import {
	type ErrorResponse,
	type SubmissionManifest,
	submitRequestSchema,
	type SubmitResponse,
} from '@/submission/submitRequest.js';
import { parseSequencingMetadata } from '@/utils/file.js';

export const submit = validateRequest(
	submitRequestSchema,
	async (req, res: Response<SubmitResponse | ErrorResponse>, next) => {
		try {
			const categoryId = Number(req.params.categoryId);
			const entityName = req.body.entityName;
			const submissionFile = req.file;
			const organization = req.body.organization;
			const sequencingMetadataValues = parseSequencingMetadata(req.body.sequencingMetadata || '');
			const user = req.user;

			logger.info(
				`Upload Submission Request: 
			categoryId: '${categoryId}', entityName: '${entityName}', organization: '${organization}', 
			submissionFile: '${submissionFile?.originalname}', sequencingMetadataValues: '${sequencingMetadataValues?.length}'`,
			);

			// Authorization check
			if (!shouldBypassAuth(req.method) && !hasUserWriteAccess(organization, user)) {
				return res.status(403).json({
					error: 'Forbidden',
					message: `User is not authorized to submit data to '${organization}'`,
				});
			}

			if (!submissionFile && (!sequencingMetadataValues || sequencingMetadataValues.length === 0)) {
				throw new lyricProvider.utils.errors.BadRequest(
					'Missing submission file and sequencing metadata. Please provide at least one of these for processing.',
				);
			}

			let activeSubmission: SubmissionSummary | undefined;

			if (sequencingMetadataValues?.length) {
				const duplicateMetadataError = getDuplicateSequencingMetadataError(
					sequencingMetadataValues,
					submissionFile?.originalname,
				);
				if (duplicateMetadataError) {
					return respondWithInvalidSubmission(res, undefined, [duplicateMetadataError]);
				}

				activeSubmission = await lyricProvider.services.submission.getActiveSubmissionByOrganization({
					categoryId,
					username: user?.username || '',
					organization,
				});

				if (activeSubmission) {
					const existingSubmissionFiles = await fetchSubmissionFilesBySubmissionId(activeSubmission.id);
					const alreadySubmittedError = getAlreadySubmittedFilesError(
						existingSubmissionFiles,
						sequencingMetadataValues,
						submissionFile?.originalname,
					);

					if (alreadySubmittedError) {
						return respondWithInvalidSubmission(res, activeSubmission.id, [alreadySubmittedError]);
					}
				}
			}

			if (!submissionFile) {
				if (!sequencingMetadataValues || sequencingMetadataValues.length === 0) {
					throw new lyricProvider.utils.errors.BadRequest(
						'The "submissionFile" parameter is missing or empty. Please include a file in the request for processing.',
					);
				}

				if (!activeSubmission) {
					throw new lyricProvider.utils.errors.BadRequest(
						'No active submission found for the provided organization and category. Please ensure that you have an active submission before submitting sequencing metadata.',
					);
				}

				const result = await handleSequencingMetadataSubmission({
					activeSubmission,
					sequencingMetadataValues,
					organization,
					entityName,
				});

				if (!result.success) {
					return respondWithInvalidSubmission(res, result.submissionId, result.errors || []);
				}

				return responseWithProcessingStatus(res, result.submissionId, result.submissionManifest);
			}

			// Get the current dictionary and validate entity name
			const currentDictionary = await getDictionary(categoryId);
			const schema = validateEntityName(currentDictionary, entityName);

			const username = user?.username || '';

			// Prevalidate Submission file
			const { error } = await prevalidateNewDataFile(submissionFile, schema);
			if (error) {
				return respondWithInvalidSubmission(res, undefined, [error]);
			}

			const result = await handleSubmission({
				submissionFile,
				sequencingMetadataValues,
				organization,
				entityName,
				categoryId,
				username,
				schema,
			});

			if (!result.success) {
				return respondWithInvalidSubmission(res, result.submissionId, result.errors || []);
			}

			return responseWithProcessingStatus(res, result.submissionId, result.submissionManifest);
		} catch (error) {
			next(error);
		}
	},
);

/**
 * Retrieves the dictionary for the given category ID.
 * @param categoryId - The ID of the category to retrieve the dictionary for.
 * @returns The current dictionary for the specified category ID.
 */
const getDictionary = async (categoryId: number) => {
	const currentDictionary = await lyricProvider.services.dictionary.getActiveDictionaryByCategory(categoryId);
	if (!currentDictionary) {
		throw new lyricProvider.utils.errors.BadRequest(`Dictionary in category '${categoryId}' not found`);
	}
	return currentDictionary;
};

/**
 * Validates the entity name against the dictionary
 * @param dictionary - Dictionary object containing the schemas
 * @param entityName - Request parameter for the entity name
 * @returns The schema object if valid, otherwise throws an error
 * @throws BadRequest if the entity name is invalid
 */
const validateEntityName = (dictionary: any, entityName: string) => {
	const schema = dictionary.dictionary.find((schema: any) => schema.name.toLowerCase() === entityName.toLowerCase());
	if (!schema) {
		throw new lyricProvider.utils.errors.BadRequest(`Invalid entity name for submission`);
	}
	return schema;
};

/**
 * Responds with an invalid submission status.
 * @param res - The response object
 * @param submissionId - The submission ID
 * @param errors - The array of batch errors
 * @returns The response object with the invalid submission status
 */
const respondWithInvalidSubmission = (
	res: Response<SubmitResponse>,
	submissionId: number | undefined,
	errors: BatchError[],
): Response<SubmitResponse> => {
	return res.status(200).send({
		submissionId,
		status: ACTIVE_SUBMISSION_STATUS.INVALID_SUBMISSION,
		submissionManifest: [],
		batchErrors: errors,
	});
};

/**
 * Response with a processing status
 * @param res - The response object
 * @param submissionId - The submission ID
 * @returns The response object with the processing status
 */
const responseWithProcessingStatus = (
	res: Response<SubmitResponse>,
	submissionId: number,
	submissionManifest?: SubmissionManifest[],
): Response<SubmitResponse> => {
	return res.status(200).send({
		submissionId,
		status: ACTIVE_SUBMISSION_STATUS.PROCESSING,
		submissionManifest: submissionManifest || [],
		batchErrors: [],
	});
};
