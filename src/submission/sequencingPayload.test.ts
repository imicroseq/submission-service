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
	buildDuplicateMd5SumErrors,
	buildDuplicateRecordIdentifierErrors,
	buildSongSubmissionPayload,
	extractInsertRecordValues,
	findDuplicateMd5SumsInMetadata,
	findDuplicateRecordIdentifiersInMetadata,
	findPreviouslySubmittedMd5SumMatches,
	findPreviouslySubmittedRecordIdentifierMatches,
} from './sequencingPayload.js';
import type { SequencingMetadataType } from './submitRequest.js';

const sequencingMetadata = (fileName: string, fileMd5sum: string): SequencingMetadataType => ({
	dataType: 'FASTQ',
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
	md5Sum: string | null,
): SelectSubmissionFile => ({
	id: 1,
	system_id: systemId,
	submission_id: submissionId,
	record_identifier: recordIdentifier,
	analysis_id: analysisId,
	md5_sum: md5Sum,
	created_at: new Date(),
});

suite('findDuplicateRecordIdentifiersInMetadata', () => {
	test('returns every entry whose file identifier occurs more than once', () => {
		const duplicateFirst = sequencingMetadata('SAMPLE001.fastq.gz', 'first-md5');
		const unique = sequencingMetadata('SAMPLE002.fastq.gz', 'unique-md5');
		const duplicateSecond = sequencingMetadata('SAMPLE001.bam', 'second-md5');

		const result = findDuplicateRecordIdentifiersInMetadata([duplicateFirst, unique, duplicateSecond]);

		assert.deepEqual(result, [duplicateFirst, duplicateSecond]);
	});

	test('returns no files when every file identifier is unique', () => {
		const result = findDuplicateRecordIdentifiersInMetadata([
			sequencingMetadata('SAMPLE001.fastq.gz', 'some-md5'),
			sequencingMetadata('SAMPLE002.fastq.gz', 'another-md5'),
		]);

		assert.deepEqual(result, []);
	});

	test('ignores empty file identifiers', () => {
		const result = findDuplicateRecordIdentifiersInMetadata([
			sequencingMetadata('', 'first-md5'),
			sequencingMetadata('', 'second-md5'),
		]);

		assert.deepEqual(result, []);
	});

	test('matches identifiers without file extensions', () => {
		const firstFile = sequencingMetadata('SAMPLE001.fastq.gz', 'first-md5');
		const secondFile = sequencingMetadata('SAMPLE001.vcf.gz', 'second-md5');

		const result = findDuplicateRecordIdentifiersInMetadata([firstFile, secondFile]);

		assert.deepEqual(result, [firstFile, secondFile]);
	});

	test('matches duplicate identifiers case-insensitively', () => {
		const firstFile = sequencingMetadata('sample001.fastq.gz', 'first-md5');
		const secondFile = sequencingMetadata('SAMPLE001.vcf.gz', 'second-md5');

		assert.deepEqual(findDuplicateRecordIdentifiersInMetadata([firstFile, secondFile]), [firstFile, secondFile]);
	});

	test('preserves the input order when multiple identifiers are duplicated', () => {
		const first = sequencingMetadata('SAMPLE001.fastq.gz', 'first-md5');
		const second = sequencingMetadata('SAMPLE002.fastq.gz', 'second-md5');
		const third = sequencingMetadata('SAMPLE001.bam', 'third-md5');
		const fourth = sequencingMetadata('SAMPLE002.vcf', 'fourth-md5');

		assert.deepEqual(findDuplicateRecordIdentifiersInMetadata([first, second, third, fourth]), [
			first,
			second,
			third,
			fourth,
		]);
	});
});

suite('findDuplicateMd5SumsInMetadata', () => {
	test('returns every entry whose non-empty MD5 sum occurs more than once', () => {
		const first = sequencingMetadata('SAMPLE001.fastq.gz', 'duplicate-md5');
		const unique = sequencingMetadata('SAMPLE002.fastq.gz', 'unique-md5');
		const second = sequencingMetadata('SAMPLE003.fastq.gz', 'duplicate-md5');

		assert.deepEqual(findDuplicateMd5SumsInMetadata([first, unique, second]), [first, second]);
	});

	test('ignores empty MD5 sums and returns no entries when all sums are unique', () => {
		const metadata = [
			sequencingMetadata('SAMPLE001.fastq.gz', ''),
			sequencingMetadata('SAMPLE002.fastq.gz', 'unique-md5'),
			sequencingMetadata('SAMPLE003.fastq.gz', ''),
		];

		assert.deepEqual(findDuplicateMd5SumsInMetadata(metadata), []);
	});

	test('matches duplicate MD5 sums case-insensitively', () => {
		const first = sequencingMetadata('SAMPLE001.fastq.gz', 'AbC123');
		const second = sequencingMetadata('SAMPLE002.fastq.gz', 'aBc123');

		assert.deepEqual(findDuplicateMd5SumsInMetadata([first, second]), [first, second]);
	});
});

suite('findPreviouslySubmittedRecordIdentifierMatches', () => {
	test('matches record identifiers case-insensitively', () => {
		const existingFiles = [
			mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123'),
			mappingSequencingMetadata(1, 'system-2', 'SAMPLE002', 'ANALYSIS002', 'xz789'),
		];

		const matchingFile = sequencingMetadata('sAmPlE001.fastq.gz', 'ABC456');
		const unmatchedFile = sequencingMetadata('SAMPLE002.fastq.gz', 'DEF456');

		const result = findPreviouslySubmittedRecordIdentifierMatches(existingFiles, [matchingFile, unmatchedFile]);

		assert.deepEqual(result, [matchingFile, unmatchedFile]);
	});

	test('matches identifiers regardless of the metadata MD5 sum', () => {
		const existingFiles = [
			mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'a1234'),
			mappingSequencingMetadata(1, 'system-2', 'SAMPLE002', 'ANALYSIS002', 'b456'),
		];

		const unmatchedFile1 = sequencingMetadata('SAMPLE001.fastq.gz', 'a1234');
		const unmatchedFile2 = sequencingMetadata('SAMPLE002.fastq.gz', 'b456');

		const result = findPreviouslySubmittedRecordIdentifierMatches(existingFiles, [unmatchedFile1, unmatchedFile2]);

		assert.deepEqual(result, [unmatchedFile1, unmatchedFile2]);
	});

	test('returns every new file matching an existing identifier', () => {
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123')];
		const firstMatch = sequencingMetadata('SAMPLE001.fastq.gz', 'first-md5');
		const secondMatch = sequencingMetadata('sample001.bam', 'second-md5');

		assert.deepEqual(findPreviouslySubmittedRecordIdentifierMatches(existingFiles, [firstMatch, secondMatch]), [
			firstMatch,
			secondMatch,
		]);
	});
});

suite('findPreviouslySubmittedMd5SumMatches', () => {
	test('returns new files whose non-empty MD5 sums already exist', () => {
		const existingFiles = [
			mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123'),
			mappingSequencingMetadata(1, 'system-2', 'SAMPLE002', 'ANALYSIS002', ''),
		];
		const matchingFile = sequencingMetadata('SAMPLE003.fastq.gz', 'abc123');
		const emptyMd5File = sequencingMetadata('SAMPLE004.fastq.gz', '');
		const unmatchedFile = sequencingMetadata('SAMPLE005.fastq.gz', 'def456');

		assert.deepEqual(findPreviouslySubmittedMd5SumMatches(existingFiles, [matchingFile, emptyMd5File, unmatchedFile]), [
			matchingFile,
		]);
	});

	test('returns files whose MD5 sums matches case insensitively', () => {
		const existingFiles = [
			mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123'),
			mappingSequencingMetadata(1, 'system-2', 'SAMPLE002', 'ANALYSIS002', ''),
		];
		const matchingFile = sequencingMetadata('SAMPLE003.fastq.gz', 'aBc123');
		const emptyMd5File = sequencingMetadata('SAMPLE004.fastq.gz', '');
		const unmatchedFile = sequencingMetadata('SAMPLE005.fastq.gz', 'def456');

		assert.deepEqual(findPreviouslySubmittedMd5SumMatches(existingFiles, [matchingFile, emptyMd5File, unmatchedFile]), [
			matchingFile,
		]);
	});

	test('returns no files when there are no existing files or matching MD5 sums', () => {
		assert.deepEqual(
			findPreviouslySubmittedMd5SumMatches([], [sequencingMetadata('SAMPLE001.fastq.gz', 'abc123')]),
			[],
		);
	});

	test('ignores existing files with a null MD5 sum, as pre-migration rows have not been backfilled', () => {
		const existingFiles = [
			mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', null),
			mappingSequencingMetadata(1, 'system-2', 'SAMPLE002', 'ANALYSIS002', null),
			mappingSequencingMetadata(1, 'system-3', 'SAMPLE003', 'ANALYSIS003', 'abc123'),
		];
		const legacyFileResubmitted = sequencingMetadata('SAMPLE001.fastq.gz', 'anything');
		const matchingFile = sequencingMetadata('SAMPLE003.fastq.gz', 'abc123');

		assert.deepEqual(findPreviouslySubmittedMd5SumMatches(existingFiles, [legacyFileResubmitted, matchingFile]), [
			matchingFile,
		]);
	});
});

suite('buildDuplicateRecordIdentifierErrors', () => {
	test('returns a batch error when metadata files were already submitted for the active submission', () => {
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123')];
		const submittedMetadata = [sequencingMetadata('SAMPLE001.fastq.gz', 'ABC123')];

		const result = buildDuplicateRecordIdentifierErrors(existingFiles, submittedMetadata, 'main-file.fastq.gz');

		assert.deepEqual(result, [
			{
				message: 'The following files have already been submitted for this submission: SAMPLE001.fastq.gz',
				type: 'INCORRECT_SECTION',
				batchName: 'main-file.fastq.gz',
			},
		]);
	});

	test('returns no errors when none of the sequencing metadata matches existing submission files', () => {
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123')];
		const metadata = [sequencingMetadata('SAMPLE002.fastq.gz', 'DEF456')];

		const result = buildDuplicateRecordIdentifierErrors(existingFiles, metadata, 'main-file.fastq.gz');

		assert.deepEqual(result, []);
	});

	test('returns both input and submitted duplicate errors and defaults the batch name', () => {
		const duplicate = sequencingMetadata('SAMPLE001.fastq.gz', 'first-md5');
		const duplicateWithDifferentExtension = sequencingMetadata('SAMPLE001.bam', 'second-md5');
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'existing-md5')];

		assert.deepEqual(
			buildDuplicateRecordIdentifierErrors(existingFiles, [duplicate, duplicateWithDifferentExtension]),
			[
				{
					message: 'The following files have duplicate identifier values: SAMPLE001.fastq.gz, SAMPLE001.bam',
					type: 'INCORRECT_SECTION',
					batchName: '',
				},
				{
					message:
						'The following files have already been submitted for this submission: SAMPLE001.fastq.gz, SAMPLE001.bam',
					type: 'INCORRECT_SECTION',
					batchName: '',
				},
			],
		);
	});
});

suite('buildDuplicateMd5SumErrors', () => {
	test('returns an input duplicate MD5 error', () => {
		const first = sequencingMetadata('SAMPLE001.fastq.gz', 'duplicate-md5');
		const second = sequencingMetadata('SAMPLE002.fastq.gz', 'duplicate-md5');

		assert.deepEqual(buildDuplicateMd5SumErrors([], [first, second], 'batch.tsv'), [
			{
				message: 'The following files have duplicate MD5 sums: SAMPLE001.fastq.gz, SAMPLE002.fastq.gz',
				type: 'INCORRECT_SECTION',
				batchName: 'batch.tsv',
			},
		]);
	});

	test('returns an existing-file duplicate MD5 error', () => {
		const metadata = sequencingMetadata('SAMPLE001.fastq.gz', 'abc123');
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE001', 'ANALYSIS001', 'abc123')];

		assert.deepEqual(buildDuplicateMd5SumErrors(existingFiles, [metadata]), [
			{
				message: 'The following files have duplicate MD5 sums: SAMPLE001.fastq.gz',
				type: 'INCORRECT_SECTION',
				batchName: '',
			},
		]);
	});

	test('returns both duplicate MD5 errors when input and existing files match', () => {
		const first = sequencingMetadata('SAMPLE001.fastq.gz', 'duplicate-md5');
		const second = sequencingMetadata('SAMPLE002.fastq.gz', 'duplicate-md5');
		const existingFiles = [mappingSequencingMetadata(1, 'system-1', 'SAMPLE003', 'ANALYSIS001', 'duplicate-md5')];

		assert.equal(buildDuplicateMd5SumErrors(existingFiles, [first, second]).length, 2);
	});

	test('returns no errors when MD5 sums are unique and not previously submitted', () => {
		assert.deepEqual(buildDuplicateMd5SumErrors([], [sequencingMetadata('SAMPLE001.fastq.gz', 'unique-md5')]), []);
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
					dataType: 'FASTQ',
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
					dataType: 'FASTQ',
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
						dataType: 'FASTQ',
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
