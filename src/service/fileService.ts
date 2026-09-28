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

import logger from '@/common/logger.js';
import type { FileMetadata } from '@/controllers/submission/getSubmissionById.js';
import { getDbInstance } from '@/db/index.js';
import { fileRepository } from '@/repository/fileRepository.js';
import {
	deleteFiles,
	getAnalysisById,
	publishAnalysis,
	suppressAnalysis,
	unpublishAnalysis,
} from '@/submission/song.js';

/**
 * Retrieves file by system ID via the mapping table
 * @param id The systemID of the submission file to retrieve
 * @returns
 */
export const fetchSubmissionFilesBySystemId = async (systemId: string) => {
	const db = getDbInstance();
	const { getSubmissionFilesBySystemId } = fileRepository(db);
	return await getSubmissionFilesBySystemId(systemId);
};

/**
 * Retrieves files linked to a submission via the mapping table
 * @param submissionId
 * @returns
 */
export const fetchSubmissionFilesBySubmissionId = async (submissionId: number) => {
	const db = getDbInstance();
	const { getSubmissionFilesBySubmissionId } = fileRepository(db);
	const submissionFiles = await getSubmissionFilesBySubmissionId(submissionId);
	logger.debug(`Found '${submissionFiles.length}' files for Submission '${submissionId}'`);
	return submissionFiles;
};

/**
 * Retrieves files by their MD5 checksums
 * @param md5sums An array of MD5 checksums to search for
 * @param committedOnly If true, only returns files that have been committed
 * @returns A list of submission files matching the given MD5 checksums
 */
export const fetchSubmissionFilesByMd5sum = async (md5sums: string[], committedOnly: boolean = false) => {
	const db = getDbInstance();
	const { getSubmissionFilesByMd5sum } = fileRepository(db);
	return await getSubmissionFilesByMd5sum(md5sums, committedOnly);
};

/**
 * Builds file metadata for all files mapped to a submission
 * @param organization
 * @param submissionId
 * @returns
 */
export const buildSubmissionFileMetadata = async (organization: string, submissionId: number) => {
	const submissionFiles = await fetchSubmissionFilesBySubmissionId(submissionId);

	const fileMetadata: FileMetadata[] = [];

	for (const file of submissionFiles) {
		const analysis = await getAnalysisById(organization, file.analysis_id);

		const analysisFile = analysis.files[0];
		if (!analysisFile) {
			continue;
		}

		// Assuming a file is considered uploaded if the analysis is published
		const isFileUploaded = analysis.analysisState === 'PUBLISHED';

		fileMetadata.push({
			objectId: analysisFile.objectId,
			fileName: analysisFile.fileName,
			md5Sum: analysisFile.fileMd5sum,
			isUploaded: isFileUploaded,
		});
	}
	return fileMetadata;
};

/**
 * Publishes all the files linked to a submission
 *
 * This function retrieves all mapped files for the specified submission,
 * then attempts to publish each one by calling SONG service.
 * If any publish attempt fails, it records the failure but continues processing the rest.
 * @param organization
 * @param submissionId
 * @returns An object containing:
 *   - `success`: `true` if all files were published successfully; otherwise `false`.
 *   - `published`: A list of analysis IDs that were successfully published.
 *   - `failed`: A list of analysis IDs that failed to publish.
 */
export const publishMappedSubmissionFiles = async (organization: string, submissionId: number) => {
	const mappedFiles = await fetchSubmissionFilesBySubmissionId(submissionId);

	const analysisPublished: string[] = [];
	const analysisFailed: string[] = [];
	for (const file of mappedFiles) {
		try {
			await publishAnalysis(organization, file.analysis_id);
			analysisPublished.push(file.analysis_id);
		} catch {
			analysisFailed.push(file.analysis_id);
		}
	}

	const allSuccessful = mappedFiles.length === analysisPublished.length;

	logger.info(
		allSuccessful
			? `Successfully published all ${analysisPublished.length} analyses for submission ID '${submissionId}'`
			: `Published ${analysisPublished.length}/${mappedFiles.length} analyses for submission ID '${submissionId}'. Failed: '${analysisFailed.join(', ')}'`,
	);

	return {
		success: allSuccessful,
		published: analysisPublished,
		failed: analysisFailed,
	};
};

/**
 * Removes from SONG service all the files linked to a submission
 *
 * This function retrieves all mapped files for the specified submission,
 * then deletes the files of each analysis and suppresses the analysis.
 * PUBLISHED analyses are unpublished first, as files can only be deleted from an UNPUBLISHED analysis.
 * Analyses already SUPPRESSED are skipped, so the operation can be safely retried.
 * If any removal attempt fails, it records the failure but continues processing the rest.
 * @param organization
 * @param submissionId
 * @returns An object containing:
 *   - `success`: `true` if all analyses were removed successfully; otherwise `false`.
 *   - `removed`: A list of analysis IDs that were successfully removed.
 *   - `failed`: A list of analysis IDs that failed to be removed.
 */
export const removeMappedSubmissionFiles = async (organization: string, submissionId: number) => {
	const mappedFiles = await fetchSubmissionFilesBySubmissionId(submissionId);

	const analysisRemoved: string[] = [];
	const analysisFailed: string[] = [];
	for (const file of mappedFiles) {
		try {
			const analysis = await getAnalysisById(organization, file.analysis_id);

			if (analysis.analysisState === 'PUBLISHED') {
				// Files can only be deleted from an UNPUBLISHED analysis
				await unpublishAnalysis(organization, file.analysis_id);
			}

			if (analysis.analysisState !== 'SUPPRESSED') {
				// Files must be deleted before suppressing, as a SUPPRESSED analysis can't be modified
				const objectIds = analysis.files.map((analysisFile) => analysisFile.objectId);
				if (objectIds.length) {
					await deleteFiles(organization, objectIds);
				}
				await suppressAnalysis(organization, file.analysis_id);
			}

			analysisRemoved.push(file.analysis_id);
		} catch {
			analysisFailed.push(file.analysis_id);
		}
	}

	const allSuccessful = analysisFailed.length === 0;

	logger.info(
		allSuccessful
			? `Successfully removed ${analysisRemoved.length}/${mappedFiles.length} analyses for submission ID '${submissionId}'`
			: `Removed ${analysisRemoved.length}/${mappedFiles.length} analyses for submission ID '${submissionId}'. Failed: '${analysisFailed.join(', ')}'`,
	);

	return {
		success: allSuccessful,
		removed: analysisRemoved,
		failed: analysisFailed,
	};
};
