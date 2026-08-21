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

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import type { SelectSubmissionFile } from '../db/schemas/record_analysis_map.js';
import {
	buildSongSubmissionPayload,
	extractInsertRecordValues,
	findAlreadySubmittedFiles,
	findDuplicateSequencingMetadata,
	getAlreadySubmittedFilesError,
	getDuplicateSequencingMetadataError,
} from './sequencingPayload.js';
import type { SequencingMetadataType } from './submitRequest.js';

const sequencingMetadata = (fileName: string, fileMd5sum: string): SequencingMetadataType => ({
	fileName,
	fileSize: 100,
	fileMd5sum,
	fileAccess: 'open',
	fileType: 'FASTQ',
});

const mappingSequencingMetadata = (
	submissionId: number,
	systemId: string,
	recordIdentifier: string,
	analysisId: string,
	md5Sum: string,
): SelectSubmissionFile => ({
	id: 1,
	system_id: systemId,
	submission_id: submissionId,
	record_identifier: recordIdentifier,
	analysis_id: analysisId,
	md5_sum: md5Sum,
	created_at: new Date(),
});

suite('findDuplicateSequencingMetadata', () => {
	test('returns every entry whose MD5 sum occurs more than once', () => {
		const duplicateFirst = sequencingMetadata('SAMPLE001.fastq.gz', 'duplicate-md5');
		const unique = sequencingMetadata('SAMPLE002.fastq.gz', 'unique-md5');
		const duplicateSecond = sequencingMetadata('SAMPLE003.fastq.gz', 'duplicate-md5');

		const result = findDuplicateSequencingMetadata([duplicateFirst, unique, duplicateSecond]);

		assert.deepEqual(result, [duplicateFirst, duplicateSecond]);
	});

	test('returns no files when every MD5 sum is unique', () => {
		const result = findDuplicateSequencingMetadata([
			sequencingMetadata('SAMPLE001.fastq.gz', 'first-md5'),
			sequencingMetadata('SAMPLE002.fastq.gz', 'second-md5'),
		]);

		assert.deepEqual(result, []);
	});

	test('ignores empty MD5 sums', () => {
		const result = findDuplicateSequencingMetadata([
			sequencingMetadata('SAMPLE001.fastq.gz', ''),
			sequencingMetadata('SAMPLE002.fastq.gz', ''),
		]);

		assert.deepEqual(result, []);
	});

	test('matches duplicate MD5 sums case-insensitively', () => {
		const uppercaseMd5 = sequencingMetadata('SAMPLE001.fastq.gz', 'ABC123');
		const lowercaseMd5 = sequencingMetadata('SAMPLE002.fastq.gz', 'abc123');

		const result = findDuplicateSequencingMetadata([uppercaseMd5, lowercaseMd5]);

		assert.deepEqual(result, [uppercaseMd5, lowercaseMd5]);
	});
});

suite('findAlreadySubmittedFiles', () => {
	test('matches MD5 sums case-insensitively', () => {
		const esistingFiles = [
			mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123'),
			mappingSequencingMetadata(1, 'system-2', 'SAMPLE002', 'ANALYSIS002', 'xz789'),
		];

		const matchingFile = sequencingMetadata('SAMPLE001.fastq.gz', 'ABC123');
		const unmatchedFile = sequencingMetadata('SAMPLE002.fastq.gz', 'DEF456');

		const result = findAlreadySubmittedFiles(esistingFiles, [matchingFile, unmatchedFile]);

		assert.deepEqual(result, [matchingFile]);
	});

	test('ignores empty MD5 sums in existing files', () => {
		const esistingFiles = [
			mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', ''),
			mappingSequencingMetadata(1, 'system-2', 'SAMPLE002', 'ANALYSIS002', ''),
		];

		const unmatchedFile1 = sequencingMetadata('SAMPLE001.fastq.gz', 'ABC123');
		const unmatchedFile2 = sequencingMetadata('SAMPLE002.fastq.gz', 'DEF456');

		const result = findAlreadySubmittedFiles(esistingFiles, [unmatchedFile1, unmatchedFile2]);

		assert.deepEqual(result, []);
	});
});

suite('getDuplicateSequencingMetadataError', () => {
	test('returns a batch error for duplicate md5 sums in the input metadata', () => {
		const duplicateFirst = sequencingMetadata('SAMPLE001.fastq.gz', 'duplicate-md5');
		const duplicateSecond = sequencingMetadata('SAMPLE003.fastq.gz', 'duplicate-md5');

		const result = getDuplicateSequencingMetadataError([duplicateFirst, duplicateSecond], 'main-file.fastq.gz');

		assert.deepEqual(result, {
			message: 'The following files have duplicate md5sum values: SAMPLE001.fastq.gz, SAMPLE003.fastq.gz',
			type: 'INCORRECT_SECTION',
			batchName: 'main-file.fastq.gz',
		});
	});

	test('returns undefined when the provided metadata has no duplicate md5 sums', () => {
		const result = getDuplicateSequencingMetadataError(
			[sequencingMetadata('SAMPLE001.fastq.gz', 'first-md5'), sequencingMetadata('SAMPLE002.fastq.gz', 'second-md5')],
			'main-file.fastq.gz',
		);

		assert.equal(result, undefined);
	});
});

suite('getAlreadySubmittedFilesError', () => {
	test('returns a batch error when metadata files were already submitted for the active submission', () => {
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123')];
		const submittedMetadata = [sequencingMetadata('SAMPLE001.fastq.gz', 'ABC123')];

		const result = getAlreadySubmittedFilesError(existingFiles, submittedMetadata, 'main-file.fastq.gz');

		assert.deepEqual(result, {
			message: 'The following files have already been submitted for this submission: SAMPLE001.fastq.gz',
			type: 'INCORRECT_SECTION',
			batchName: 'main-file.fastq.gz',
		});
	});

	test('returns undefined when none of the sequencing metadata matches existing submission files', () => {
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123')];
		const metadata = [sequencingMetadata('SAMPLE002.fastq.gz', 'DEF456')];

		const result = getAlreadySubmittedFilesError(existingFiles, metadata, 'main-file.fastq.gz');

		assert.equal(result, undefined);
	});
});

suite('extractInsertRecordValues', () => {
	test('returns an empty array when given no records', () => {
		const result = extractInsertRecordValues([]);
		assert.deepEqual(result, []);
	});

	test('keeps only INSERTS records, filtering out UPDATES and DELETES', () => {
		const result = extractInsertRecordValues([
			{ type: 'INSERTS', value: { specimen_collector_sample_id: 'SAMPLE001' } },
			{ type: 'UPDATES', value: { specimen_collector_sample_id: 'SAMPLE002' } },
			{ type: 'DELETES', value: { specimen_collector_sample_id: 'SAMPLE003' } },
		]);
		assert.deepEqual(result, [{ specimen_collector_sample_id: 'SAMPLE001' }]);
	});

	test('stringifies non-string field values, defaulting null and undefined to an empty string', () => {
		const result = extractInsertRecordValues([
			{ type: 'INSERTS', value: { count: 3, active: true, missing: null, unset: undefined } },
		]);
		assert.deepEqual(result, [{ count: '3', active: 'true', missing: '', unset: '' }]);
	});
});

suite('buildSongSubmissionPayload', () => {
	const fileNameIdentifier = 'specimen_collector_sample_id';
	const organization = 'test-org';

	test('returns an empty array when no sequencing file matches a clinical record', () => {
		const result = buildSongSubmissionPayload({
			sequencingFilesMetadata: [
				{
					fileName: 'SAMPLE001.fastq.gz',
					fileSize: 100,
					fileMd5sum: 'abc123',
					fileAccess: 'open',
					fileType: 'FASTQ',
					identifier: 'SAMPLE001',
				},
			],
			extractedData: [{ specimen_collector_sample_id: 'SAMPLE999' }],
			organization,
			fileNameIdentifier,
		});

		assert.deepEqual(result, []);
	});

	test('builds a Song payload for each sequencing file matched by the identifier column', () => {
		const result = buildSongSubmissionPayload({
			sequencingFilesMetadata: [
				{
					fileName: 'SAMPLE001.fastq.gz',
					fileSize: 100,
					fileMd5sum: 'abc123',
					fileAccess: 'open',
					fileType: 'FASTQ',
					identifier: 'SAMPLE001',
				},
			],
			extractedData: [
				{
					specimen_collector_sample_id: 'SAMPLE001',
					insdc_project_accession: 'PRJ1',
					insdc_sample_accession: 'SAM1',
				},
				{ specimen_collector_sample_id: 'SAMPLE999' },
			],
			organization,
			fileNameIdentifier,
		});

		assert.deepEqual(result, [
			{
				studyId: 'test-org',
				analysisType: { name: 'imicroseq_wastewater' },
				specimen_collector_sample_id: 'SAMPLE001',
				insdc_project_accession: 'PRJ1',
				insdc_sample_accession: 'SAM1',
				files: [
					{
						fileName: 'SAMPLE001.fastq.gz',
						fileSize: 100,
						fileMd5sum: 'abc123',
						fileAccess: 'open',
						fileType: 'FASTQ',
					},
				],
			},
		]);
	});
});
