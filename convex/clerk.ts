// Historical name: these internal queries look up profiles by local Convex Auth user ID
// (stored in the legacy `clerkId` field). Clerk itself is not used.
export { getUserByClerkId, getUserById } from './clerk/queries';
