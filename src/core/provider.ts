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

import { type AppConfig, provider } from '@overture-stack/lyric';

import { env } from '@/common/envConfig.js';
import { onFinishCommitCallback } from '@/indexer/onFinishCommit.js';
import { verifyToken } from '@/middleware/verifyEgoJwt.js';

const appConfig: AppConfig = {
	auth: {
		enabled: env.AUTH_ENABLED,
		customAuthHandler: verifyToken,
		protectedMethods: env.AUTH_PROTECT_METHODS,
	},
	db: {
		host: env.DB_HOST,
		port: env.DB_PORT,
		database: env.DB_NAME,
		user: env.DB_USER,
		password: env.DB_PASSWORD,
	},
	features: {
		audit: {
			enabled: env.AUDIT_ENABLED,
		},
		recordHierarchy: {
			pluralizeSchemasName: env.PLURALIZE_SCHEMAS_ENABLED,
		},
	},
	idService: {
		customAlphabet: env.ID_CUSTOMALPHABET,
		customSize: env.ID_CUSTOMSIZE,
		useLocal: env.ID_USELOCAL,
	},
	logger: {
		level: env.LOG_LEVEL,
	},
	onFinishCommit: onFinishCommitCallback,
	schemaService: {
		url: env.LECTERN_URL,
	},
	submissionService: {
		maxFileSize: 10000000, // 10MB default max file size for submission service, can be overridden by env variable
	},
	validator: [],
};

export const lyricProvider = provider(appConfig);
