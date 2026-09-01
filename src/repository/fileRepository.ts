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

import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import logger from '@/common/logger.js';
import { lyricProvider } from '@/core/provider.js';
import type { PostgresDb } from '@/db/index.js';
import { type InsertSubmissionFile, type SelectSubmissionFile, submissionFiles } from '@/db/schemas/index.js';

export const fileRepository = (db: PostgresDb) => {
	return {
		/**
		 * Retrieves submission files by their MD5 checksums
		 * @param md5sums Array of MD5 checksums to search for
		 * @param committedOnly If true, only returns files that have been committed
		 * @returns Array of matching submission files
		 */
		getSubmissionFilesByMd5sum: async (
			md5sums: string[],
			committedOnly: boolean = false,
		): Promise<SelectSubmissionFile[]> => {
			try {
				return await db
					.select()
					.from(submissionFiles)
					.where(
						and(
							inArray(submissionFiles.md5_sum, md5sums),
							committedOnly ? isNotNull(submissionFiles.system_id) : undefined,
						),
					);
			} catch (error) {
				logger.error(error, 'Error querying submission files by MD5hashes.');
				throw new lyricProvider.utils.errors.InternalServerError(
					'Something went wrong while fetching files for submission. Please try again later.',
				);
			}
		},
		/**
		 * Retrieves a submission file by its system ID
		 * @param systemId The system Id of the submission file
		 * @returns the matching submission file, or `undefined` if no file is found
		 */
		getSubmissionFilesBySystemId: async (systemId: string): Promise<SelectSubmissionFile | undefined> => {
			try {
				const result = await db.select().from(submissionFiles).where(eq(submissionFiles.system_id, systemId)).limit(1);
				// Should be only 1 record by system ID
				return result[0];
			} catch (error) {
				logger.error(error, 'Error querying submission file by system id.');
				throw new lyricProvider.utils.errors.InternalServerError(
					'Something went wrong while fetching file by system id. Please try again later.',
				);
			}
		},

		/**
		 * Fetch submission files mapping from the database
		 * @param submissionId ID of the submission to fetch files for
		 * @returns Array of file information  associated with the submission
		 */
		getSubmissionFilesBySubmissionId: async (submissionId: number): Promise<SelectSubmissionFile[]> => {
			try {
				return await db.select().from(submissionFiles).where(eq(submissionFiles.submission_id, submissionId));
			} catch (error) {
				logger.error(error, 'Error querying submission files.');
				throw new lyricProvider.utils.errors.InternalServerError(
					'Something went wrong while fetching files for submission. Please try again later.',
				);
			}
		},
		/**
		 * Save submission files mapping in to the database
		 * @param record Submission file mapping values to be inserted in the database
		 * @returns The resulting object stored
		 */
		saveSubmissionFiles: async (record: InsertSubmissionFile[]): Promise<SelectSubmissionFile[]> => {
			try {
				logger.debug(`Inserting Submission file with data: ${JSON.stringify(record)}`);
				return await db.insert(submissionFiles).values(record).returning();
			} catch (error) {
				logger.error(error, 'Error saving submission files');
				throw new lyricProvider.utils.errors.InternalServerError(
					'Something went wrong while saving files for submission. Please try again later.',
				);
			}
		},
		/**
		 * Updates a submission file in the database by its ID with the provided data.
		 * @param id The unique identifier of the submission file to be updated
		 * @param data A partial object containing the fields of `InsertSubmissionFile` to be updated.
		 * @returns The resulting object stored
		 */
		updateSubmissionFiles: async (id: number, data: Partial<Omit<InsertSubmissionFile, 'id'>>) => {
			try {
				logger.debug(`Updating submission file id '${id}' with fields: ${JSON.stringify(data)}`);
				return await db.update(submissionFiles).set(data).where(eq(submissionFiles.id, id)).returning();
			} catch (error) {
				logger.error(error, 'Error updating submission file.');
				throw new lyricProvider.utils.errors.InternalServerError(
					'Something went wrong while updating file for submission. Please try again later.',
				);
			}
		},
	};
};
