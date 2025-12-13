# Tasks: Modular Discord Bot with WhatsApp Sync and Message Tracking

**Input**: Design documents from `/specs/001-modular-architecture/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are not explicitly requested in the specification and follow existing Jest patterns. Test tasks are included where constitution requires them.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

This project uses FrijoleBot's existing structure:
- **Bot backend**: `services/`, `handlers/`, `utils/`, `modules/` at repository root
- **Admin UI**: `apps/control-panel/`
- **Tests**: `tests/` at repository root
- **Config**: `config/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependency updates and project structure preparation

- [X] T001 Update @whiskeysockets/baileys to v7.0.0-rc.9+ in package.json (CRITICAL - fixes 405 error)
- [X] T002 [P] Update discord.js to v14.25.1+ in package.json
- [X] T003 [P] Verify Node.js version is 20.x and install all npm dependencies
- [X] T004 [P] Ensure CONFIG_CRYPTO_KEY environment variable is set in .env file
- [X] T005 [P] Create modules/base/ directory structure
- [X] T006 [P] Create utils/moduleLoader.js placeholder file
- [X] T007 Verify PostgreSQL and Redis services are running via docker compose

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core module infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Create ModuleInterface base class in modules/base/ModuleInterface.js with lifecycle hooks (initialize, enable, disable, cleanup, getHealth)
- [X] T009 Implement dynamic module loader in utils/moduleLoader.js (scans modules/ directory, instantiates classes)
- [X] T010 Extend PostgreSQL schema in services/PostgreSQLService.js initializeDatabase() with modules table
- [X] T011 Extend PostgreSQL schema in services/PostgreSQLService.js initializeDatabase() with module_states table and indexes
- [X] T012 [P] Extend PostgreSQL schema in services/PostgreSQLService.js initializeDatabase() with user_tracking_preferences table and indexes
- [X] T013 [P] Extend PostgreSQL schema in services/PostgreSQLService.js initializeDatabase() with tracked_messages table and indexes
- [X] T014 [P] Add columns to existing whatsapp_chats table (sync_media, last_message_at) with ALTER TABLE IF NOT EXISTS
- [X] T015 [P] Add columns to existing whatsapp_sessions table (guild_id, qr_retry_count) with ALTER TABLE IF NOT EXISTS
- [X] T016 Create ModuleService in services/ModuleService.js with loadModules(), enableModule(), disableModule(), getModuleHealth(), validateDependencies()
- [X] T017 Create ModuleHandler in handlers/moduleHandler.js with registerModuleCommands(), unregisterModuleCommands(), routeCommand()
- [X] T018 Integrate ModuleService into discord-link-bot.js main() function after existing service initialization (around line 45)
- [X] T019 Write unit tests for ModuleService in tests/services/ModuleService.test.js (85%+ coverage)
- [X] T020 [P] Write unit tests for moduleLoader in tests/utils/moduleLoader.test.js

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Module Management via Web UI (Priority: P1) 🎯 MVP

**Goal**: Enable administrators to enable/disable feature modules through a web interface without code changes or server restarts. This is the core architectural requirement that all other features depend on.

**Independent Test**: Access the web UI at /admin/modules, toggle a test module on/off, verify module status changes in database and that module commands appear/disappear in Discord without requiring a restart.

### Implementation for User Story 1

- [X] T021 [P] [US1] Create GET /api/modules route in apps/control-panel/app/api/modules/route.ts (list all modules for guild)
- [X] T022 [P] [US1] Create POST /api/modules/[moduleId]/enable route in apps/control-panel/app/api/modules/[moduleId]/enable/route.ts
- [X] T023 [P] [US1] Create POST /api/modules/[moduleId]/disable route in apps/control-panel/app/api/modules/[moduleId]/disable/route.ts
- [X] T024 [P] [US1] Create GET /api/modules/[moduleId]/health route in apps/control-panel/app/api/modules/[moduleId]/health/route.ts
- [X] T025 [US1] Create module list page in apps/control-panel/app/admin/modules/page.tsx with enable/disable toggles
- [X] T026 [US1] Create module detail page in apps/control-panel/app/admin/modules/[moduleId]/page.tsx with configuration form
- [X] T027 [US1] Add module status badges (enabled/disabled/healthy/unhealthy) to module list UI
- [X] T028 [US1] Implement client-side module dependency validation before enabling in module detail page
- [X] T029 [US1] Test module enable/disable workflow: Enable test module → verify DB updated → verify no restart required → disable → verify cleanup

**Checkpoint**: User Story 1 (Module Management) is fully functional - administrators can control modules via web UI

---

## Phase 4: User Story 2 - WhatsApp Chat Synchronization (Priority: P2)

**Goal**: Allow Discord server administrators to forward WhatsApp messages to specific Discord channels, with QR code authentication from Discord and real-time message forwarding.

**Independent Test**: Enable WhatsApp module via admin UI, initiate QR code auth from Discord, scan QR code, configure chat-to-channel mapping, send WhatsApp message, verify it appears in mapped Discord channel within 5 seconds.

### Implementation for User Story 2

- [ ] T030 [P] [US2] Create WhatsAppModule class in modules/whatsapp/WhatsAppModule.js extending ModuleInterface
- [ ] T031 [P] [US2] Define WhatsApp slash commands in modules/whatsapp/commands.js (/whatsapp_auth, /whatsapp_chats, /whatsapp_map, /whatsapp_unmap)
- [ ] T032 [P] [US2] Define WhatsApp module config schema in modules/whatsapp/config.js (adminChannelId, maxChatMappings)
- [ ] T033 [US2] Update services/WhatsAppService.js to use Baileys v7.0.0-rc.9 initialization patterns (fix 405 error)
- [ ] T034 [US2] Implement QR code generation in WhatsAppModule.handleAuthCommand() using qrcode.toBuffer() and Discord attachment
- [ ] T035 [US2] Implement WhatsApp message event listener in WhatsAppService for messages.upsert event
- [ ] T036 [US2] Implement chat-to-channel mapping logic in WhatsAppModule (query whatsapp_chats table, forward to Discord)
- [ ] T037 [US2] Add WhatsApp media download and Discord forwarding using Baileys downloadMediaMessage()
- [ ] T038 [US2] Implement session persistence verification (restore from auth_info_baileys/ on restart)
- [ ] T039 [US2] Add WhatsApp connection status monitoring and admin channel notifications
- [ ] T040 [P] [US2] Create GET /api/whatsapp/session/status route in apps/control-panel/app/api/whatsapp/session/route.ts
- [ ] T041 [P] [US2] Create POST /api/whatsapp/session/qr route in apps/control-panel/app/api/whatsapp/session/qr/route.ts
- [ ] T042 [P] [US2] Create GET /api/whatsapp/chats route in apps/control-panel/app/api/whatsapp/chats/route.ts (list mappings)
- [ ] T043 [P] [US2] Create POST /api/whatsapp/chats route in apps/control-panel/app/api/whatsapp/chats/route.ts (create mapping)
- [ ] T044 [P] [US2] Create DELETE /api/whatsapp/chats/[chatId] route in apps/control-panel/app/api/whatsapp/chats/[chatId]/route.ts
- [ ] T045 [P] [US2] Create GET /api/whatsapp/chats/available route in apps/control-panel/app/api/whatsapp/chats/available/route.ts
- [ ] T046 [US2] Create WhatsApp management UI page in apps/control-panel/app/admin/whatsapp/page.tsx (session status, chat list, mapping interface)
- [ ] T047 [US2] Add WhatsApp session status display with connection indicators to admin UI
- [ ] T048 [US2] Add available chats selector and Discord channel dropdown for mapping creation
- [ ] T049 [US2] Write unit tests for WhatsAppService in tests/services/WhatsAppService.test.js
- [ ] T050 [US2] Write integration test for WhatsApp→Discord sync in tests/integration/WhatsAppDiscordSync.test.js
- [ ] T051 [US2] Test end-to-end: Enable module → QR auth → map chat → send WhatsApp msg → verify Discord message appears

**Checkpoint**: User Story 2 (WhatsApp Sync) is fully functional - WhatsApp messages forward to Discord in real-time

---

## Phase 5: User Story 3 - Message Tracking from Specific Users (Priority: P3)

**Goal**: Allow Discord users to track unread messages from specific people, with read/unread status management and proper Discord message limit handling.

**Independent Test**: Enable message tracking module, add a user to tracking list via /track command, have that user send messages, use /unread command to view unread messages (testing with 50+ messages to verify pagination), mark messages as read, verify they disappear from unread list.

### Implementation for User Story 3

- [ ] T052 [P] [US3] Create MessageTrackingService in services/MessageTrackingService.js with addTrackingPreference(), removeTrackingPreference(), trackMessage(), getUnreadMessages(), markAsRead(), cleanupExpiredMessages()
- [ ] T053 [P] [US3] Add formatUnreadMessagesForDiscord() method to MessageTrackingService (handles Discord 6000 char limit, splits into chunks of 12 messages)
- [ ] T054 [P] [US3] Create MessageTrackingModule class in modules/message-tracking/MessageTrackingModule.js extending ModuleInterface
- [ ] T055 [P] [US3] Define message tracking slash commands in modules/message-tracking/commands.js (/track, /untrack, /unread, /tracked_list)
- [ ] T056 [P] [US3] Define message tracking config schema in modules/message-tracking/config.js
- [ ] T057 [US3] Implement /track command handler in MessageTrackingModule (add to user_tracking_preferences)
- [ ] T058 [US3] Implement /untrack command handler in MessageTrackingModule (remove from user_tracking_preferences)
- [ ] T059 [US3] Implement /unread command handler with Discord message splitting logic (chunk size 12, use followUp for subsequent embeds)
- [ ] T060 [US3] Implement /tracked_list command handler in MessageTrackingModule (show current tracking preferences)
- [ ] T061 [US3] Add message capture hook in handlers/messageHandler.js to detect messages from tracked users
- [ ] T062 [US3] Implement guild isolation validation (ensure queries scoped by guild_id)
- [ ] T063 [US3] Add 30-day message retention cleanup job to services/SchedulerService.js calling cleanupExpiredMessages()
- [ ] T064 [P] [US3] Create GET /api/tracking/preferences route in apps/control-panel/app/api/tracking/preferences/route.ts
- [ ] T065 [P] [US3] Create POST /api/tracking/preferences route in apps/control-panel/app/api/tracking/preferences/route.ts
- [ ] T066 [P] [US3] Create DELETE /api/tracking/preferences/[trackedUserId] route
- [ ] T067 [P] [US3] Create GET /api/tracking/messages/unread route in apps/control-panel/app/api/tracking/messages/route.ts
- [ ] T068 [P] [US3] Create POST /api/tracking/messages/[messageId]/read route
- [ ] T069 [P] [US3] Create POST /api/tracking/messages/bulk-read route
- [ ] T070 [US3] Create message tracking UI page in apps/control-panel/app/admin/tracking/page.tsx (tracking list, unread messages view, mark as read)
- [ ] T071 [US3] Add paginated unread messages display to tracking UI (limit 50, offset parameter)
- [ ] T072 [US3] Add bulk mark-as-read functionality to tracking UI
- [ ] T073 [US3] Write unit tests for MessageTrackingService in tests/services/MessageTrackingService.test.js (85%+ coverage)
- [ ] T074 [US3] Write integration test for message tracking workflow in tests/integration/MessageTracking.test.js
- [ ] T075 [US3] Write integration test for /unread with 50+ messages in tests/integration/MessageTrackingLimits.test.js (verify multiple embeds sent, no "Invalid Form Body" errors)
- [ ] T076 [US3] Test end-to-end: Enable module → add tracking → send 50+ messages → /unread → verify split across multiple embeds → mark read → verify removed

**Checkpoint**: User Story 3 (Message Tracking) is fully functional - users can track messages with proper pagination

---

## Phase 6: User Story 4 - Module Addition and Maintenance (Priority: P4)

**Goal**: Validate that developers can add new feature modules without modifying core bot code, demonstrating true modularity and extensibility.

**Independent Test**: Create a new test module (HelloWorldModule) following quickstart.md, add it to modules/ directory, verify it appears in admin UI module list, enable it, test its commands work, disable it, verify commands disappear - all without touching core code.

### Implementation for User Story 4

- [ ] T077 [P] [US4] Create comprehensive quickstart.md tutorial in specs/001-modular-architecture/ (already exists - verify completeness)
- [ ] T078 [P] [US4] Create example HelloWorldModule in modules/hello-world/HelloWorldModule.js for quickstart tutorial
- [ ] T079 [P] [US4] Create hello-world commands in modules/hello-world/commands.js (/hello)
- [ ] T080 [P] [US4] Create hello-world config schema in modules/hello-world/config.js
- [ ] T081 [P] [US4] Create hello-world README in modules/hello-world/README.md
- [ ] T082 [US4] Test module auto-discovery: Add HelloWorldModule → restart bot → verify appears in modules table
- [ ] T083 [US4] Test module isolation: Introduce intentional error in HelloWorldModule.enable() → verify other modules continue working
- [ ] T084 [US4] Test module dependencies: Create dependent module → attempt to enable without dependency → verify blocked with helpful error
- [ ] T085 [US4] Verify module updates don't affect core: Modify HelloWorldModule code → verify core bot code unchanged
- [ ] T086 [US4] Write unit tests for HelloWorldModule in tests/modules/HelloWorld.test.js following quickstart.md example
- [ ] T087 [US4] Test developer workflow: Follow quickstart.md from scratch → create new module → enable via UI → test commands → verify success

**Checkpoint**: User Story 4 (Module Extensibility) is validated - developers can add modules without core changes

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, documentation, and quality improvements

- [ ] T088 [P] Write integration test for module lifecycle in tests/integration/ModuleLifecycle.test.js (load → enable → process command → disable → verify cleanup)
- [ ] T089 [P] Update CLAUDE.md with module development guidance (verify modular architecture section present, database schema updated, new services documented)
- [ ] T090 [P] Update repository README.md with module management section, available modules list, link to quickstart.md
- [ ] T091 [P] Verify all integration tests pass with >80% coverage for new services
- [ ] T092 Verify all success metrics from plan.md: Baileys ≥7.0.0-rc.9, no 405 errors, enable/disable works without restart, /unread handles 50+ messages
- [ ] T093 Run full test suite (npm test) and ensure all tests pass
- [ ] T094 Test health endpoints return 200 status with module health details
- [ ] T095 Verify Discord commands respond within 3 seconds performance target
- [ ] T096 Verify WhatsApp messages forward within 5 seconds performance target
- [ ] T097 Test guild isolation: Create data in guild A, query from guild B, verify no data leakage
- [ ] T098 Security audit: Verify parameterized queries, no SQL injection vulnerabilities, guild_id scoping enforced
- [ ] T099 Code review: Check for common pitfalls from plan.md (forgetting guild isolation, not using ephemeral replies, missing rate limiting, etc.)
- [ ] T100 Create deployment checklist verifying CONFIG_CRYPTO_KEY set, PostgreSQL/Redis running, WhatsApp session volume mounted

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - US1 (Module Management) can proceed after Phase 2
  - US2 (WhatsApp Sync) depends on US1 (needs module system to be enabled/disabled)
  - US3 (Message Tracking) depends on US1 (needs module system to be enabled/disabled)
  - US4 (Extensibility) depends on US1 (validates module system works)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on US1 (requires module management system) - Can run in parallel with US3
- **User Story 3 (P3)**: Depends on US1 (requires module management system) - Can run in parallel with US2
- **User Story 4 (P4)**: Depends on US1 (validates module system) - Should run after US2 or US3 to validate real modules

### Within Each User Story

- API routes marked [P] can run in parallel within a story
- Models/services marked [P] can run in parallel
- UI pages depend on API routes being complete
- Tests should be written alongside implementation
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- Phase 1: T001-T007 can run mostly in parallel (T001 should go first as critical)
- Phase 2: T010-T015 (schema changes) can all run in parallel; T019-T020 (tests) can run in parallel
- US2: T030-T032, T040-T045 can all run in parallel initially
- US3: T052-T056, T064-T069 can all run in parallel initially
- US4: T077-T081 can all run in parallel
- Polish: T088-T091 can all run in parallel

---

## Parallel Example: User Story 2

```bash
# After Phase 2 complete, these US2 tasks can launch together:

# Module structure files (different files, no dependencies):
Task T030: "Create WhatsAppModule class in modules/whatsapp/WhatsAppModule.js"
Task T031: "Define WhatsApp slash commands in modules/whatsapp/commands.js"
Task T032: "Define WhatsApp module config schema in modules/whatsapp/config.js"

# API routes (different files, no dependencies):
Task T040: "Create GET /api/whatsapp/session/status route"
Task T041: "Create POST /api/whatsapp/session/qr route"
Task T042: "Create GET /api/whatsapp/chats route"
Task T043: "Create POST /api/whatsapp/chats route"
Task T044: "Create DELETE /api/whatsapp/chats/[chatId] route"
Task T045: "Create GET /api/whatsapp/chats/available route"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Module Management)
4. **STOP and VALIDATE**: Test module enable/disable via web UI
5. Deploy/demo if ready - you now have a working modular architecture!

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 (Module Management) → Test independently → Deploy/Demo (MVP! 🎯)
3. Add User Story 2 (WhatsApp Sync) → Test independently → Deploy/Demo
4. Add User Story 3 (Message Tracking) → Test independently → Deploy/Demo
5. Add User Story 4 (Extensibility Validation) → Confirm architecture works → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Developer A: User Story 1 (Module Management) - BLOCKS others
3. Once US1 done (module system working):
   - Developer B: User Story 2 (WhatsApp Sync)
   - Developer C: User Story 3 (Message Tracking)
   - Both can work in parallel as they're independent
4. Developer A or B: User Story 4 (Extensibility Validation)
5. Team: Polish phase together

---

## Task Summary

- **Total Tasks**: 100
- **Setup Phase**: 7 tasks
- **Foundational Phase**: 13 tasks (BLOCKS all user stories)
- **User Story 1 (P1 - MVP)**: 9 tasks (Module Management via Web UI)
- **User Story 2 (P2)**: 22 tasks (WhatsApp Chat Synchronization)
- **User Story 3 (P3)**: 25 tasks (Message Tracking from Specific Users)
- **User Story 4 (P4)**: 11 tasks (Module Addition and Maintenance)
- **Polish Phase**: 13 tasks (Integration, docs, quality)

**Parallel Opportunities Identified**: 42 tasks marked [P] across all phases

**Independent Test Criteria**:
- **US1**: Enable/disable module via web UI without restart
- **US2**: WhatsApp message appears in Discord within 5 seconds
- **US3**: Track users, view 50+ unread messages split across embeds
- **US4**: Create new module without touching core code

**Suggested MVP Scope**: Complete through Phase 3 (User Story 1) for a working modular architecture foundation

---

## Notes

- [P] tasks = different files, no dependencies within phase
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Tests written alongside implementation (Jest with V8 coverage)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- CRITICAL: Update Baileys to v7.0.0-rc.9+ first (T001) to fix WhatsApp 405 error
- All database queries must use parameterized syntax ($1, $2) for SQL injection prevention
- All Discord user-private data must use MessageFlags.Ephemeral
- All queries must be scoped by guild_id for multi-tenant isolation
- /unread command must handle Discord 6000 char limit by splitting into multiple embeds
