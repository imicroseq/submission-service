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

import { z } from 'zod';

import { env } from '@/common/envConfig.js';
import logger from '@/common/logger.js';
import { fileMetadataSchema } from '@/submission/submitRequest.js';

import fetchWithAuth from './fetchWithAuth.js';

/**
 * Response returned by Song on successful submission.
 */
const SubmitResponseSchema = z.object({
	analysisId: z.string(),
	status: z.string(),
});

type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

const isSubmitSuccessResponse = (data: unknown): data is SubmitResponse => {
	return SubmitResponseSchema.safeParse(data).success;
};

/**
 * Submits a payload using a POST request with authentication.
 * @param organization - The organization to submit to
 * @param payload - The payload to submit
 * @returns The JSON response or throws on error with a message
 */
export const submit = async (organization: string, payload: any): Promise<SubmitResponse> => {
	const apiUrl = new URL(`/submit/${organization}`, env.SEQUENCING_SUBMISSION_URL);
	apiUrl.searchParams.append('allowDuplicates', String(env.SEQUENCING_SUBMISSION_ALLOW_DUPLICATES));
	logger.debug(`Sequencing submission with payload: ${JSON.stringify(payload)}`);
	const response = await fetchWithAuth(apiUrl.toString(), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		let message = `Sequencing Submission failed with status '${response.status}'`;
		try {
			const errorBody = await response.json();
			const errorDetail = typeof errorBody?.message === 'string' ? errorBody.message : JSON.stringify(errorBody);
			message += `: ${errorDetail}`;
		} catch {
			message += `: Failed to parse error response`;
		}
		logger.error(message);
		throw new Error(message);
	}

	try {
		const data = await response.json();

		if (!isSubmitSuccessResponse(data)) {
			logger.error(`Unexpected response format: ${JSON.stringify(data)}`);
			throw new Error('Invalid response format');
		}
		logger.debug(`Song submission result: ${data.status} - ${data.analysisId}`);

		return data;
	} catch {
		logger.error('Failed to parse successful response as JSON');
		throw new Error('Invalid JSON in sequencing submission response');
	}
};

/**
 * Schema for file metadata used in analysis files.
 */
export const AnalysisFilesSchema = fileMetadataSchema.extend({
	objectId: z.string(),
	studyId: z.string(),
	analysisId: z.string(),
});

export type AnalysisFilesType = z.infer<typeof AnalysisFilesSchema>;

/**
 * Retrieves the files associated with a specific analysis
 * @param organization
 * @param analysisId
 * @returns
 */
export const getAnalysisFilesByAnalysisId = async (
	organization: string,
	analysisId: string,
): Promise<AnalysisFilesType[]> => {
	logger.debug(`Retrieving files for analysisId: ${analysisId}`);
	const apiUrl = new URL(
		`/studies/${organization}/analysis/${analysisId}/files`,
		env.SEQUENCING_SUBMISSION_URL,
	).toString();
	const response = await fetchWithAuth(apiUrl, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
		},
	});

	if (!response.ok) {
		let message = `Get files from analysis failed with status '${response.status}'`;
		try {
			const errorBody = await response.json();
			const errorDetail = typeof errorBody?.message === 'string' ? errorBody.message : JSON.stringify(errorBody);
			message += `: ${errorDetail}`;
		} catch {
			message += `: Failed to parse error response`;
		}
		logger.error(message);
		throw new Error(message);
	}

	try {
		const jsonResponse = await response.json();
		logger.debug(`Response analysis id '${analysisId}': ${JSON.stringify(jsonResponse)}`);
		return AnalysisFilesSchema.array().parse(jsonResponse);
	} catch {
		logger.error('Failed to parse successful response as JSON');
		throw new Error('Invalid JSON in retriving files for analysis response');
	}
};

export const AnalysisBaseResponseSchema = z.object({
	analysisId: z.string(),
	analysisState: z.enum(['UNPUBLISHED', 'PUBLISHED', 'SUPPRESSED']),
	analysisType: z.object({ name: z.string(), version: z.number().optional() }),
	createdAt: z.string(),
	files: z.array(AnalysisFilesSchema),
	firstPublishedAt: z.string().nullable(),
	publishedAt: z.string().nullable(),
	studyId: z.string(),
	updatedAt: z.string(),
});

export type AnalysisResponse = z.infer<typeof AnalysisBaseResponseSchema>;

/**
 * Retrieves the analysis by ID
 * @param organization
 * @param analysisId
 * @returns
 */
export const getAnalysisById = async (organization: string, analysisId: string): Promise<AnalysisResponse> => {
	logger.debug(`Retrieving analysis for ID '${analysisId}'`);
	const apiUrl = new URL(`/studies/${organization}/analysis/${analysisId}`, env.SEQUENCING_SUBMISSION_URL).toString();
	const response = await fetchWithAuth(apiUrl, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
		},
	});

	if (!response.ok) {
		let message = `Get analysis failed with status '${response.status}'`;
		try {
			const errorBody = await response.json();
			const errorDetail = typeof errorBody?.message === 'string' ? errorBody.message : JSON.stringify(errorBody);
			message += `: ${errorDetail}`;
		} catch {
			message += `: Failed to parse error response`;
		}
		logger.error(message);
		throw new Error(message);
	}

	try {
		const jsonResponse = await response.json();
		logger.debug(`Response analysis id '${analysisId}': ${JSON.stringify(jsonResponse)}`);
		return AnalysisBaseResponseSchema.parse(jsonResponse);
	} catch {
		logger.error('Failed to parse successful response as JSON');
		throw new Error('Invalid JSON in retriving Analysis response');
	}
};

/**
 * Publishes an Analysis in SONG service
 * @param organization
 * @param analysisId
 * @param ignoreUndefinedMd5
 * @returns a string if analysis is successfully published. Otherwise, throws an error with details
 */
export const publishAnalysis = async (
	organization: string,
	analysisId: string,
	ignoreUndefinedMd5: boolean = false,
) => {
	logger.debug(`Publishing analysis ID '${analysisId}'`);

	const apiUrl = new URL(`/studies/${organization}/analysis/publish/${analysisId}`, env.SEQUENCING_SUBMISSION_URL);
	apiUrl.searchParams.append('ignoreUndefinedMd5', String(ignoreUndefinedMd5));
	const response = await fetchWithAuth(apiUrl.toString(), {
		method: 'PUT',
	});

	if (!response.ok) {
		let message = `Publish analysis failed with status '${response.status}'`;
		try {
			const errorBody = await response.json();
			const errorDetail = typeof errorBody?.message === 'string' ? errorBody.message : JSON.stringify(errorBody);
			message += `: ${errorDetail}`;
		} catch {
			message += `: Failed to parse error response`;
		}
		logger.error(message);
		throw new Error(message);
	}

	try {
		const textResponse = await response.text();
		logger.debug(`Response analysis id '${analysisId}': ${textResponse}`);
		return textResponse;
	} catch {
		logger.error('Failed to parse successful response as JSON');
		throw new Error('Invalid JSON in retriving Analysis response');
	}
};

/**
 * Deletes files from SONG service by their object IDs
 * @param organization
 * @param objectIds
 * @returns a string if files are successfully deleted. Otherwise, throws an error with details
 */
export const deleteFiles = async (organization: string, objectIds: string[]) => {
	logger.debug(`Deleting files with object IDs '${objectIds.join(', ')}'`);

	const apiUrl = new URL(`/studies/${organization}/files/${objectIds.join(',')}`, env.SEQUENCING_SUBMISSION_URL);
	const response = await fetchWithAuth(apiUrl.toString(), {
		method: 'DELETE',
	});

	if (!response.ok) {
		let message = `Delete files failed with status '${response.status}'`;
		try {
			const errorBody = await response.json();
			const errorDetail = typeof errorBody?.message === 'string' ? errorBody.message : JSON.stringify(errorBody);
			message += `: ${errorDetail}`;
		} catch {
			message += `: Failed to parse error response`;
		}
		logger.error(message);
		throw new Error(message);
	}

	const textResponse = await response.text();
	logger.debug(`Response deleting files '${objectIds.join(', ')}': ${textResponse}`);
	return textResponse;
};

/**
 * Suppresses an Analysis in SONG service
 * @param organization
 * @param analysisId
 * @returns a string if analysis is successfully suppressed. Otherwise, throws an error with details
 */
export const suppressAnalysis = async (organization: string, analysisId: string) => {
	logger.debug(`Suppressing analysis ID '${analysisId}'`);

	const apiUrl = new URL(`/studies/${organization}/analysis/suppress/${analysisId}`, env.SEQUENCING_SUBMISSION_URL);
	const response = await fetchWithAuth(apiUrl.toString(), {
		method: 'PUT',
	});

	if (!response.ok) {
		let message = `Suppress analysis failed with status '${response.status}'`;
		try {
			const errorBody = await response.json();
			const errorDetail = typeof errorBody?.message === 'string' ? errorBody.message : JSON.stringify(errorBody);
			message += `: ${errorDetail}`;
		} catch {
			message += `: Failed to parse error response`;
		}
		logger.error(message);
		throw new Error(message);
	}

	const textResponse = await response.text();
	logger.debug(`Response suppressing analysis id '${analysisId}': ${textResponse}`);
	return textResponse;
};

/**
 * Unpublishes an Analysis in SONG service
 * @param organization
 * @param analysisId
 * @returns a string if analysis is successfully unpublished. Otherwise, throws an error with details
 */
export const unpublishAnalysis = async (organization: string, analysisId: string) => {
	logger.debug(`Unpublishing analysis ID '${analysisId}'`);

	const apiUrl = new URL(`/studies/${organization}/analysis/unpublish/${analysisId}`, env.SEQUENCING_SUBMISSION_URL);
	const response = await fetchWithAuth(apiUrl.toString(), {
		method: 'PUT',
	});

	if (!response.ok) {
		let message = `Unpublish analysis failed with status '${response.status}'`;
		try {
			const errorBody = await response.json();
			const errorDetail = typeof errorBody?.message === 'string' ? errorBody.message : JSON.stringify(errorBody);
			message += `: ${errorDetail}`;
		} catch {
			message += `: Failed to parse error response`;
		}
		logger.error(message);
		throw new Error(message);
	}

	const textResponse = await response.text();
	logger.debug(`Response unpublishing analysis id '${analysisId}': ${textResponse}`);
	return textResponse;
};
