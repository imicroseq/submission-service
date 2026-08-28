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

import { sql } from 'drizzle-orm';
import { index, integer, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

import { schema } from './schema.js';

export const submissionFiles = schema.table(
	'record_analysis_map',
	{
		id: serial().primaryKey(),
		submission_id: integer().notNull(),
		record_identifier: varchar({ length: 255 }).notNull(),
		analysis_id: varchar({ length: 255 }).notNull(),
		md5_sum: varchar({ length: 255 }),
		system_id: varchar({ length: 255 }),
		created_at: timestamp().notNull().defaultNow(),
	},
	(table) => [
		index('submission_id_idx').on(table.submission_id),
		index('system_id_idx').on(table.system_id),
		index('md5_sum_idx')
			.on(table.md5_sum, table.system_id)
			.where(sql`${table.md5_sum} IS NOT NULL`),
	],
);

export type SelectSubmissionFile = typeof submissionFiles.$inferSelect;
export type InsertSubmissionFile = typeof submissionFiles.$inferInsert;
