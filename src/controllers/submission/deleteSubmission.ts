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
import { z as zod } from 'zod';

import {
	type DeleteSubmissionResult,
	inProcessSubmissionStatus,
	isSubmissionActive,
	SUBMISSION_STATUS,
} from '@overture-stack/lyric';

import { hasUserWriteAccess, shouldBypassAuth } from '@/common/auth.js';
import { env } from '@/common/envConfig.js';
import logger from '@/common/logger.js';
import { lyricProvider } from '@/core/provider.js';
import { type RequestValidation, validateRequest } from '@/middleware/requestValidation.js';
import { removeMappedSubmissionFiles } from '@/service/fileService.js';

interface DeleteSubmissionPathParams extends ParamsDictionary {
	submissionId: string;
}

interface DeleteSubmissionQueryParams {
	force?: string;
}

export const DeleteSubmissionRequestSchema: RequestValidation<
	object,
	DeleteSubmissionQueryParams,
	DeleteSubmissionPathParams
> = {
	pathParams: zod.object({
		submissionId: zod.string(),
	}),
	query: zod.object({
		force: zod
			.string()
			.regex(/^(true|false)$/i, { message: "Invalid value for 'force'. Only 'true' or 'false' are accepted" })
			.optional(),
	}),
};

/**
 * Closes a Submission, removing the sequencing files submitted to Song before closing it in Lyric.
 * Active Submissions (OPEN, VALID, INVALID) can always be closed.
 * Submissions stuck in process (VALIDATING, COMMITTING) can only be closed with `force`.
 * CLOSED Submissions can be closed again with `force`, to clean up the files left in Song.
 * COMMITTED Submissions cannot be closed, even with `force`.
 */
export const deleteSubmission = validateRequest(
	DeleteSubmissionRequestSchema,
	async (req, res: Response<DeleteSubmissionResult>, next) => {
		try {
			const submissionId = Number(req.params.submissionId);
			const user = req.user;
			const force = req.query.force?.toLowerCase() === 'true';

			logger.info(`Request Delete Active Submission '${submissionId}'`);

			const submission = await lyricProvider.services.submission.getSubmissionById(submissionId);

			if (!submission) {
				throw new lyricProvider.utils.errors.BadRequest(`Submission '${submissionId}' not found`);
			}

			// Authorization check
			if (!shouldBypassAuth(req.method) && !hasUserWriteAccess(submission.organization, user)) {
				throw new lyricProvider.utils.errors.Forbidden(
					`User is not authorized to delete the submission from '${submission.organization}'`,
				);
			}

			if (submission.status === SUBMISSION_STATUS.COMMITTED) {
				throw new lyricProvider.utils.errors.StatusConflict('Committed Submissions cannot be deleted');
			}

			const isActive = isSubmissionActive(submission.status);
			const isInProcess = inProcessSubmissionStatus.some((status) => status === submission.status);
			const isClosed = submission.status === SUBMISSION_STATUS.CLOSED;

			// Safeguard for any status not covered above (COMMITTED is already rejected),
			// e.g. a new status added in a future Lyric version
			if (!isActive && !isInProcess && !isClosed) {
				throw new lyricProvider.utils.errors.StatusConflict(
					`Submission with status '${submission.status}' cannot be deleted`,
				);
			}

			if (!isActive && !force) {
				// Cannot delete non-active submissions without force
				throw new lyricProvider.utils.errors.StatusConflict(
					`Submission with status '${submission.status}' can only be deleted using 'force'`,
				);
			}

			if (env.SEQUENCING_SUBMISSION_ENABLED) {
				const resultRemoveSubmissionFiles = await removeMappedSubmissionFiles(submission.organization, submission.id);

				if (!resultRemoveSubmissionFiles.success) {
					throw new lyricProvider.utils.errors.InternalServerError(
						`Cannot close submission. Files with analysis IDs ${resultRemoveSubmissionFiles.failed} failed to be removed`,
					);
				}
			}

			const username = user?.username || '';

			const deleteSubmissionResult = await lyricProvider.services.submission.deleteActiveSubmissionById(
				submissionId,
				username,
				force,
			);

			return res.status(200).send(deleteSubmissionResult);
		} catch (error) {
			next(error);
		}
	},
);
