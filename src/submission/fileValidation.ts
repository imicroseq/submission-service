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

import { BATCH_ERROR_TYPE, type BatchError, type Schema } from '@overture-stack/lyric';

import { env } from '@/common/envConfig.js';
import logger from '@/common/logger.js';
import type { SequencingMetadataType } from '@/submission/submitRequest.js';
import { getIdentifierFromFileName } from '@/utils/file.js';
import { asArray } from '@/utils/format.js';

import { getSeparatorCharacter } from './format.js';
import { readHeaders } from './readFile.js';

/**
 * Pre-validates a new data file before submission.
 *
 * This function performs a series of checks on the provided file to ensure it meets the necessary criteria before it can be submitted for data processing.
 * The following checks are performed:
 * - Verifies that the file has the correct extension.
 * - Ensures the file's text format is correct.
 * - Confirms that the file contains the required column names as per the provided schema.
 *
 * If any of these checks fail, an error is returned along with the file.
 * @param file The file to be validated
 * @param schema The schema against which the file will be validated
 * @returns
 */
export const prevalidateNewDataFile = async (
	file: Express.Multer.File,
	schema: Schema,
): Promise<{ error?: BatchError; file: Express.Multer.File }> => {
	// check if extension is supported
	const separatorCharacter = getSeparatorCharacter(file.originalname);
	if (!separatorCharacter) {
		const message = `Invalid file extension ${file.originalname.split('.')[1]}`;
		logger.info(`Prevalidation file '${file.originalname}' failed - ${message}`);
		return {
			error: {
				type: BATCH_ERROR_TYPE.INVALID_FILE_EXTENSION,
				message,
				batchName: file.originalname,
			},
			file,
		};
	}

	const firstLine = await readHeaders(file);
	const fileHeaders = firstLine.split(separatorCharacter).map((str) => str.trim());

	const missingRequiredFields = findMissingRequiredFields(schema, fileHeaders);

	if (missingRequiredFields.length > 0) {
		const fieldNames = missingRequiredFields.map((field) => field.name);
		const message = `Missing required fields '${JSON.stringify(fieldNames)}'`;
		logger.info(`Prevalidation file '${file.originalname}' failed - ${message}`);
		return {
			error: {
				type: BATCH_ERROR_TYPE.MISSING_REQUIRED_HEADER,
				message,
				batchName: file.originalname,
			},
			file,
		};
	}
	return { file };
};

/**
 * Pre-validates a new data file before submission.
 *
 * This function performs a series of checks on the provided file to ensure it meets the necessary criteria before it can be submitted for data processing.
 * The following checks are performed:
 * - Verifies that the file has the correct extension.
 * - Ensures the file's text format is correct.
 * - Confirms that the file contains the required column names as per the provided schema.
 *
 * If any of these checks fail, an error is returned along with the file.
 * @param file The file to be validated
 * @param schema The schema against which the file will be validated
 * @returns
 */
export const prevalidateEditFile = async (
	file: Express.Multer.File,
	schema: Schema,
): Promise<{ error?: BatchError; file: Express.Multer.File }> => {
	// check if extension is supported
	const separatorCharacter = getSeparatorCharacter(file.originalname);
	if (!separatorCharacter) {
		const message = `Invalid file extension ${file.originalname.split('.')[1]}`;
		logger.info(`Prevalidation file '${file.originalname}' failed - ${message}`);
		return {
			error: {
				type: BATCH_ERROR_TYPE.INVALID_FILE_EXTENSION,
				message,
				batchName: file.originalname,
			},
			file,
		};
	}

	const firstLine = await readHeaders(file);
	const fileHeaders = firstLine.split(separatorCharacter).map((str) => str.trim());

	if (!fileHeaders.includes('systemId')) {
		const message = `File is missing the column 'systemId'`;
		logger.info(`Prevalidation file '${file.originalname}' failed - ${message}`);
		return {
			error: {
				type: BATCH_ERROR_TYPE.MISSING_REQUIRED_HEADER,
				message,
				batchName: file.originalname,
			},
			file,
		};
	}

	const missingRequiredFields = findMissingRequiredFields(schema, fileHeaders);
	if (missingRequiredFields.length > 0) {
		const fieldNames = missingRequiredFields.map((field) => field.name);
		const message = `Missing required fields '${JSON.stringify(fieldNames)}'`;
		logger.info(`Prevalidation file '${file.originalname}' failed - ${message}`);
		return {
			error: {
				type: BATCH_ERROR_TYPE.MISSING_REQUIRED_HEADER,
				message,
				batchName: file.originalname,
			},
			file,
		};
	}
	return { file };
};

export interface SequencingValidationResult {
	errors: BatchError[];
	validFiles: (SequencingMetadataType & { identifier: string })[];
}

/**
 * Validates sequencing files metadata against the extracted data.
 * It checks if the file names in the additional metadata match the file identifier in the extracted data.
 * @param sequencingFilesMetadata - Additional metadata for sequencing files
 * @param clinicalData - parsed clinical data from the main file
 * @param batchName - The name of the main file being processed
 * @returns An array of BatchError objects if there are mismatches, otherwise null
 */
export const buildSequencingFilesMetadata = (
	sequencingFilesMetadata: SequencingMetadataType[],
	clinicalData: Record<string, string>[],
	batchName: string,
): SequencingValidationResult => {
	const result: SequencingValidationResult = {
		errors: [],
		validFiles: [],
	};

	const filenameIdentifierColumn = env.SEQUENCING_SUBMISSION_FILENAME_IDENTIFIER_COLUMN;

	if (sequencingFilesMetadata.length === 0 || !filenameIdentifierColumn) {
		return result;
	}

	// Parse file names to extract identifiers
	const parsedFiles = sequencingFilesMetadata.map((item) => ({
		...item,
		identifier: getIdentifierFromFileName(item.fileName),
	}));
	const unmatchedMetadata = [...parsedFiles];

	// Collect invalid file name formats
	const invalidFiles = unmatchedMetadata.filter((file) => !file.identifier);
	if (invalidFiles.length > 0) {
		result.errors = invalidFiles.map((file) => ({
			type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
			message: `Invalid sequencing file name '${file.fileName}'`,
			batchName,
		}));
		return result;
	}

	const clinicalIdentifiers = new Set(clinicalData.map((record) => record[filenameIdentifierColumn]).filter(Boolean));

	for (const file of parsedFiles) {
		if (file.identifier && clinicalIdentifiers.has(file.identifier)) {
			result.validFiles.push(file);
		} else {
			result.errors.push({
				type: BATCH_ERROR_TYPE.INCORRECT_SECTION,
				message: `Sequencing file name '${file.fileName}' does not match any '${filenameIdentifierColumn}' value in submission file`,
				batchName,
			});
		}
	}

	return result;
};

/**
 * Converters the Sequencing metadata to a payload format.
 */
export const buildFileMetadata = (file: SequencingMetadataType & { identifier: string }): SequencingMetadataType => {
	return {
		dataType: file.fileType,
		fileName: file.fileName,
		fileSize: file.fileSize,
		fileMd5sum: file.fileMd5sum,
		fileAccess: file.fileAccess,
		fileType: file.fileType,
	};
};

/**
 * This function checks that every required field in the schema exists in the file headers,
 * matching whether as field displayName or field name.
 * Returns the fields that are missing
 */
const findMissingRequiredFields = (schema: Schema, fileHeaders: string[]) => {
	return schema.fields
		.filter((field) => field.restrictions && 'required' in field.restrictions) // filter required fields
		.filter((field) => {
			const possibleNames = asArray([
				field.meta?.displayName?.toString() || '',
				field.displayName?.toString() || '',
				field.name,
			]);

			return !possibleNames.some((name) => fileHeaders.includes(name));
		});
};
