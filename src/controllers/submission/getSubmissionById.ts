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
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';
import { z } from 'zod';

import type { SubmissionStatus, SubmissionSummary } from '@overture-stack/lyric';

import { shouldBypassAuth } from '@/common/auth.js';
import logger from '@/common/logger.js';
import { lyricProvider } from '@/core/provider.js';
import { type RequestValidation, validateRequest } from '@/middleware/requestValidation.js';
import { buildSubmissionFileMetadata } from '@/service/fileService.js';
import type { ErrorResponse } from '@/submission/submitRequest.js';

interface GetSubmissionRequestPathParams extends ParamsDictionary {
	submissionId: string;
}

export const getSubmissionByIdRequestSchema: RequestValidation<object, ParsedQs, GetSubmissionRequestPathParams> = {
	pathParams: z.object({
		submissionId: z.string(),
	}),
};

export type FileMetadata = {
	objectId: string;
	fileName: string;
	md5Sum?: string;
	isUploaded: boolean;
};

export type GetSubmissionResponse = {
	files: FileMetadata[];
} & SubmissionSummary;

/**
 * Polling configuration constants
 */
// TODO: abstract these as external configs. e.g. env vars
const POLLING_INTERVAL_MS = 3000; // Send status update every 3 seconds
const STALE_SUBMISSION_THRESHOLD_MS = 600000; // 10 minutes - stop polling if submission hasn't been updated
const POLLING_MAX_DURATION_MS = 600000; // 10 minutes - maximum time to keep polling active
const TERMINAL_SUBMISSION_STATUSES = new Set<SubmissionStatus>(['CLOSED', 'COMMITTED', 'INVALID']);

/**
 * Handles the request to get a submission by its ID.
 * Streams submission status updates until the submission reaches a terminal status,
 * becomes stale, or the polling timeout expires.
 */
export const getSubmissionById = validateRequest(
	getSubmissionByIdRequestSchema,
	async (req, res: Response<GetSubmissionResponse | ErrorResponse>, next) => {
		// Configure response as Server-Sent Events (SSE) stream
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');

		const submissionId = Number(req.params.submissionId);
		logger.info(`Request Get Submission ID '${submissionId}'`);

		// Authorization check
		if (!shouldBypassAuth(req.method)) {
			return res.status(403).json({
				error: 'Forbidden',
				message: `User is not authorized to get submission with id '${submissionId}'`,
			});
		}

		let pollingTimeoutId: NodeJS.Timeout | null = null;
		const pollingStartTime = Date.now();

		let previousSubmissionData: SubmissionSummary;

		/**
		 * Cleans up polling resources and closes the response stream
		 */
		const stopPolling = (): void => {
			if (pollingTimeoutId) {
				clearTimeout(pollingTimeoutId);
				pollingTimeoutId = null;
			}
			res.end();
		};

		// Stop polling if the client closes or aborts the connection
		req.on('close', stopPolling);
		req.on('aborted', stopPolling);

		/**
		 * Fetches the current submission status and streams whenever it changes
		 * This function will continue calling itself until at least 1 of these conditions are true:
		 * - The submission has a terminal status (TERMINAL_SUBMISSION_STATUSES)
		 * - Last update on a submission was more than STALE_SUBMISSION_THRESHOLD_MS,
		 * - Function has been running more than POLLING_MAX_DURATION_MS.
		 */
		const pollSubmissionStatus = async (): Promise<void> => {
			// Fetch current submission data
			const submissionData = await lyricProvider.services.submission.getSubmissionById(submissionId);

			if (!submissionData) {
				throw new lyricProvider.utils.errors.NotFound(`Submission with id '${submissionId}' not found`);
			}

			// Build and send response
			const files = await buildSubmissionFileMetadata(submissionData.organization, submissionId);
			const response: GetSubmissionResponse = {
				...submissionData,
				files,
			};

			// Only send update if submission data has changed since last poll
			const hasSubmissionChanged =
				previousSubmissionData === undefined ||
				previousSubmissionData.status != submissionData.status ||
				previousSubmissionData.data.total != submissionData.data.total ||
				previousSubmissionData.updatedAt != submissionData.updatedAt;

			if (hasSubmissionChanged) {
				res.write(`data: ${JSON.stringify(response)}\n\n`);
				previousSubmissionData = submissionData;
			}

			// Check if submission data is stale (hasn't been updated recently)
			const submissionLastUpdateTime = new Date(submissionData.updatedAt).getTime();
			const currentTime = Date.now();
			const timeSinceLastUpdate = currentTime - submissionLastUpdateTime;
			const isSubmissionStale = timeSinceLastUpdate > STALE_SUBMISSION_THRESHOLD_MS;

			if (isSubmissionStale) {
				logger.info(`Polling stopped: Submission has not been updated in ${timeSinceLastUpdate}ms`);
				return stopPolling();
			}

			// Stop polling if submission has reached a terminal state
			if (TERMINAL_SUBMISSION_STATUSES.has(submissionData.status)) {
				logger.info(`Polling stopped: Submission reached terminal status ${submissionData.status}`);
				return stopPolling();
			}

			// Stop polling if max duration exceeded
			const pollingDuration = currentTime - pollingStartTime;
			if (pollingDuration > POLLING_MAX_DURATION_MS) {
				logger.info(`Polling stopped: Maximum polling duration (${POLLING_MAX_DURATION_MS}ms) exceeded`);
				return stopPolling();
			}

			// continue the loop
			pollingTimeoutId = setTimeout(pollSubmissionStatus, POLLING_INTERVAL_MS);
		};

		try {
			await pollSubmissionStatus();
		} catch (error) {
			next(error);
		}
	},
);
