<!--
Sync Impact Report:
- Version: none → 1.0.0 (MINOR: Initial constitution creation)
- Added Principles:
  1. Test Coverage & Quality
  2. Service Layer Architecture
  3. User Experience Consistency
  4. Performance & Monitoring
  5. Security & Data Protection
- Added Sections:
  - Quality Gates
  - Development Workflow
- Templates Status:
  ✅ .specify/templates/plan-template.md (Constitution Check section present)
  ✅ .specify/templates/spec-template.md (User scenarios & testing aligned)
  ✅ .specify/templates/tasks-template.md (Task organization aligned)
- Follow-up TODOs: None
-->

# FrijoleBot Constitution

## Core Principles

### I. Test Coverage & Quality (NON-NEGOTIABLE)

All services, handlers, and utilities MUST have corresponding test coverage:

- **Unit tests** for services (`services/**/*.js`) and handlers (`handlers/**/*.js`) are
  MANDATORY before implementation is merged
- **Integration tests** MUST be written for cross-service interactions (Discord ↔ WhatsApp,
  PostgreSQL ↔ Services)
- Tests MUST use Jest with V8 coverage provider
- Coverage collected from: `services/**`, `handlers/**`, `utils/**`, `config/**`
- Test files follow naming: `*.test.js` or `*.spec.js`
- All tests MUST pass in CI (`npm run test:ci`) before merge

**Rationale**: The multi-service architecture (Discord bot, WhatsApp connector, Admin UI)
requires comprehensive testing to prevent regressions across integration boundaries.

### II. Service Layer Architecture

All business logic MUST be implemented in service classes under `services/`:

- Services are stateful classes with dependency injection (config, postgres, discord client)
- Each service MUST have a single, well-defined responsibility:
  - PostgreSQLService: Database operations, schema, feature flags
  - WhatsAppService: Baileys connector, session management, message forwarding
  - CacheService: Redis/in-memory caching abstraction
  - HealthCheckService: Health endpoints with metrics
  - SchedulerService: Background task scheduling
- Handlers (`handlers/`) are thin orchestration layers that delegate to services
- Direct database access outside PostgreSQLService is PROHIBITED

**Rationale**: Service layer provides testability, clear boundaries, and enables independent
evolution of Discord/WhatsApp/Admin UI features.

### III. User Experience Consistency

All user-facing interactions MUST follow established patterns:

- **Discord interactions**: All slash commands MUST use ephemeral replies for user-private
  data (links, settings)
- **Rate limiting**: All slash commands MUST be rate-limited via CommandHandler
- **Error messages**: User-friendly error messages with actionable guidance (no stack traces
  in Discord messages)
- **Admin UI**: Database-driven configuration via Admin UI at `/admin` (no environment
  variable reconfiguration required)
- **Health endpoints**: Liveness (`/health/live`) and readiness (`/health/ready`) MUST follow
  Kubernetes probe conventions
- **Logging**: Structured JSON logs in production, pretty logs in dev (via `utils/logger.js`)

**Rationale**: Consistent UX patterns reduce user confusion and operational overhead across
Discord commands, WhatsApp forwarding, and Admin UI.

### IV. Performance & Monitoring

All features MUST meet performance baselines and provide observability:

- **Response time**: Discord slash commands MUST respond within 3 seconds (defer if needed)
- **Caching**: Feature flags cached for 60 seconds, database queries cached via CacheService
  where appropriate
- **Health checks**: All services MUST report health status via HealthCheckService
- **Metrics exposure**: Health endpoint (`/health`) MUST include uptime, memory usage,
  connection status
- **Database queries**: Indexed queries for high-frequency operations (guild_id, user_id,
  chat_id)
- **Session persistence**: WhatsApp sessions MUST persist via Docker volumes to avoid
  re-authentication

**Rationale**: Multi-tenant Discord/WhatsApp usage requires predictable performance and
operational visibility for Kubernetes deployments.

### V. Security & Data Protection

All sensitive data MUST be encrypted at rest and in transit:

- **Token encryption**: Discord bot tokens MUST be encrypted using AES-256-GCM via
  `services/tokenCrypto.js` with `CONFIG_CRYPTO_KEY`
- **WhatsApp sessions**: Local file storage only (no database persistence of Baileys
  credentials)
- **Secrets in environment**: `CONFIG_CRYPTO_KEY`, `POSTGRES_PASSWORD`,
  `ADMIN_NOTIFY_TOKEN` MUST NOT be committed to git
- **SQL injection prevention**: All PostgreSQL queries MUST use parameterized queries
  (`$1`, `$2`, etc.)
- **Access control**: Multi-server support requires guild_id isolation (no cross-guild
  data leakage)
- **Security scanning**: Weekly security scans via GitHub Actions (Trivy, npm audit)

**Rationale**: Discord bots have access to message content and personal WhatsApp accounts
require strict security controls.

## Quality Gates

All code changes MUST pass these gates before merge:

### Pre-Commit Gates

- [ ] Linting passes (if configured)
- [ ] All tests pass locally (`npm test`)
- [ ] New services/handlers have corresponding test files

### CI/CD Gates (GitHub Actions)

- [ ] All tests pass (`npm run test:ci`)
- [ ] Docker build succeeds for multi-arch (amd64, arm64)
- [ ] Security scan passes (Trivy, npm audit)
- [ ] Health check endpoints respond correctly in Docker container

### Code Review Gates

- [ ] Service layer changes have unit tests
- [ ] Integration points (Discord ↔ WhatsApp, DB ↔ Services) have integration tests
- [ ] User-facing changes follow UX consistency principles
- [ ] Sensitive data follows encryption requirements
- [ ] Database queries use parameterized syntax

## Development Workflow

### Feature Development Process

1. **Specification**: Define user scenarios and acceptance criteria in spec.md
2. **Planning**: Design service interfaces and database schema changes in plan.md
3. **Test-First**: Write failing tests for new services/handlers before implementation
4. **Implementation**: Implement services following architecture principles
5. **Integration**: Add handler orchestration and command routing
6. **Documentation**: Update CLAUDE.md for architectural changes, README.md for user-facing
   features
7. **Review**: Submit PR with tests passing and quality gates satisfied

### Testing Strategy

- **Unit tests**: Mock dependencies (PostgreSQL, Discord client, Baileys) to test service
  logic in isolation
- **Integration tests**: Use test database for multi-service interactions
- **Fixtures**: Shared mock data in `tests/fixtures/mockData.js`
- **Setup**: Global test setup in `tests/setup.js` for environment configuration

### Database Schema Changes

1. Add table creation in `PostgreSQLService.initializeDatabase()`
2. Use `CREATE TABLE IF NOT EXISTS` for idempotent schema initialization
3. Add query methods to PostgreSQLService for new tables
4. Update integration tests to cover new schema
5. Document schema changes in CLAUDE.md Database Schema section

### Configuration Management

- **Infrastructure config**: Environment variables (`POSTGRES_*`, `CONFIG_CRYPTO_KEY`)
- **Runtime config**: Database-driven via Admin UI (`app_settings` table)
- **Feature flags**: `feature_flags` table with 60s cache TTL
- **Config precedence**: Database settings override environment variables

## Governance

This constitution supersedes all other development practices and coding standards.

### Amendment Process

1. Propose amendment via GitHub issue with rationale and impact analysis
2. Update constitution with semantic version bump:
   - MAJOR: Backward incompatible principle changes (e.g., removing Test Coverage requirement)
   - MINOR: New principle additions or expanded guidance
   - PATCH: Clarifications, typo fixes, non-semantic refinements
3. Update dependent templates (plan-template.md, spec-template.md, tasks-template.md)
4. Document in Sync Impact Report at top of constitution file
5. Update CLAUDE.md if principles affect development guidance

### Compliance Reviews

- All pull requests MUST verify compliance with Core Principles
- Constitution Check in plan-template.md MUST be completed before implementation
- Violations require explicit justification in PR description
- Repeated violations without justification may block merge

### Guidance Reference

For runtime development guidance and architecture details, see `CLAUDE.md`.

**Version**: 1.0.0 | **Ratified**: 2025-12-11 | **Last Amended**: 2025-12-11
