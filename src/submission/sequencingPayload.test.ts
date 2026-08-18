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

import {
	buildSongSubmissionPayload,
	extractInsertRecordValues,
	findAlreadySubmittedFiles,
	findDuplicateSequencingMetadata,
} from './sequencingPayload.js';

const sequencingMetadata = (fileName: string, fileMd5sum: string) => ({
	fileName,
	fileSize: 100,
	fileMd5sum,
	fileAccess: 'open',
	fileType: 'FASTQ',
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
	test('matches MD5 sums case-insensitively and ignores empty existing values', () => {
		const matchingFile = sequencingMetadata('SAMPLE001.fastq.gz', 'ABC123');
		const unmatchedFile = sequencingMetadata('SAMPLE002.fastq.gz', 'DEF456');

		const result = findAlreadySubmittedFiles([{ md5Sum: 'abc123' }, { md5Sum: '' }, {}], [matchingFile, unmatchedFile]);

		assert.deepEqual(result, [matchingFile]);
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
