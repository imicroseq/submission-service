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

import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';
import { z as zod, ZodError } from 'zod';

import type { ActiveSubmissionStatus, BatchError } from '@overture-stack/lyric';

import logger from '@/common/logger.js';
import type { RequestValidation } from '@/middleware/requestValidation.js';

interface SubmitRequestPathParams extends ParamsDictionary {
	categoryId: string;
}

const md5SumValidation = zod.string().regex(/^[a-fA-F0-9]{32}$/, {
	message: 'Invalid MD5 sum format. Must be a 32-character hexadecimal string.',
});

export const fileMetadataSchema = zod.object({
	fileName: zod.string(),
	fileSize: zod.coerce.number(),
	fileMd5sum: md5SumValidation.optional(),
	fileAccess: zod.string(),
	fileType: zod.string(),
});
export type SequencingMetadataType = zod.infer<typeof fileMetadataSchema>;

export const submitRequestSchema: RequestValidation<
	{ entityName: string; organization: string; sequencingMetadata?: string },
	ParsedQs,
	SubmitRequestPathParams
> = {
	body: zod.object({
		entityName: zod.string(),
		organization: zod.string(),
		sequencingMetadata: zod
			.string()
			.optional()
			.superRefine((str, ctx) => {
				let parsed = '';
				try {
					if (!str) {
						// If the string is empty, we don't need to parse it
						return;
					}
					parsed = JSON.parse(str);
				} catch (e) {
					logger.error(e, 'Invalid JSON format');
					ctx.addIssue({
						code: zod.ZodIssueCode.custom,
						message: 'Invalid JSON format',
					});
					return;
				}

				const result = zod.array(fileMetadataSchema).safeParse(parsed);
				if (!result.success) {
					logger.error(result.error, 'Zod error');
					if (result.error instanceof ZodError) {
						const errorMessages = result.error.errors
							.map((issue) => `${issue.path.join('.')} is ${issue.message}`)
							.join(' | ');

						ctx.addIssue({
							code: zod.ZodIssueCode.custom,
							message: errorMessages,
						});
					} else {
						ctx.addIssue({
							code: zod.ZodIssueCode.custom,
							message: `Invalid JSON format. ${result.error}`,
						});
					}
				}
			})
			.optional(),
	}),
	pathParams: zod.object({
		categoryId: zod.string(),
	}),
};

export type ErrorResponse = {
	error: string;
	message: string;
};

export type SubmissionManifest = {
	objectId: string;
	fileName: string;
	md5Sum?: string;
};

export type SubmitResponse = {
	submissionId?: number;
	status: ActiveSubmissionStatus;
	submissionManifest: SubmissionManifest[];
	batchErrors: BatchError[];
};
