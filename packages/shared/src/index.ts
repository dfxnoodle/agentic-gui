// Types
export type { CLIProvider, UnifiedEvent, SSEEnvelope } from './types/cli-events.js';
export type { ConversationState, Message, Conversation } from './types/conversation.js';
export type { PlanStatus, PlanSection, ContradictionConflict, ContradictionCheck, Plan } from './types/plan.js';
export type { CLIConfig, AuthFieldDef, AuthModeDef, ProviderConfig, Project, CredentialPreference } from './types/project.js';
export type { UserRole, User, PublicUser, AuthenticatedUser } from './types/user.js';

// Constants
export {
	DEFAULT_ROLE_DEFINITIONS,
	PERMISSIONS,
	ROLE_PERMISSIONS,
	buildRolePermissionsMap,
	hasPermission,
} from './constants/roles.js';
export type { Permission, RoleDefinition } from './constants/roles.js';
export { PLAN_TRANSITIONS, canTransition } from './constants/plan-states.js';
export { CLI_PROVIDERS, CLI_DISPLAY_NAMES, CLI_AUTH_MODES } from './constants/cli-providers.js';
