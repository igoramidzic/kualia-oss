import { getIdentity } from '../../lib/identity';
import { ConvexError, v } from 'convex/values';

import { action, internalMutation, internalQuery } from '../../_generated/server';
import { saltedgeRequest, validateSaltEdgeConfig } from './saltedgeClient';

/**
 * Salt Edge Customer response
 */
interface SaltEdgeCustomer {
  id: string;
  identifier: string;
  secret: string;
  created_at: string;
  updated_at: string;
}

interface CreateCustomerResponse {
  data: SaltEdgeCustomer;
}

interface GetCustomerResponse {
  data: SaltEdgeCustomer;
}

/**
 * Create a new Salt Edge customer
 * Each user in your system should have a corresponding Salt Edge customer
 */
export const createCustomer = action({
  args: {
    identifier: v.optional(v.string()), // Optional unique identifier for the customer
  },
  handler: async (ctx, args) => {
    // Verify authentication (actions use getUserIdentity directly)
    const identity = await getIdentity(ctx);
    if (!identity) {
      throw new ConvexError('Authentication required');
    }

    const orgId = (identity as { org_id?: string }).org_id;
    if (!orgId) {
      throw new ConvexError('No workspace selected');
    }

    // Validate Salt Edge configuration
    validateSaltEdgeConfig();

    // Use subject (user ID) as identifier if not provided
    const identifier = args.identifier ?? identity.subject;

    try {
      // Create customer in Salt Edge
      const response = await saltedgeRequest<CreateCustomerResponse>('/customers', {
        method: 'POST',
        body: {
          data: {
            identifier,
          },
        },
      });

      // Return customer data
      return {
        customerId: response.data.id,
        identifier: response.data.identifier,
        secret: response.data.secret,
        createdAt: response.data.created_at,
      };
    } catch (error) {
      console.error('Error creating Salt Edge customer:', error);
      throw new Error(
        `Failed to create Salt Edge customer: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});

/**
 * Get an existing Salt Edge customer by ID
 */
export const getCustomer = action({
  args: {
    customerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const identity = await getIdentity(ctx);
    if (!identity) {
      throw new ConvexError('Authentication required');
    }

    // Validate Salt Edge configuration
    validateSaltEdgeConfig();

    try {
      // Fetch customer from Salt Edge
      const response = await saltedgeRequest<GetCustomerResponse>(`/customers/${args.customerId}`, {
        method: 'GET',
      });

      // Return customer data
      return {
        customerId: response.data.id,
        identifier: response.data.identifier,
        secret: response.data.secret,
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at,
      };
    } catch (error) {
      console.error('Error fetching Salt Edge customer:', error);
      throw new Error(
        `Failed to fetch Salt Edge customer: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});

/**
 * Remove a Salt Edge customer
 * This will also remove all connections associated with the customer
 */
export const removeCustomer = action({
  args: {
    customerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const identity = await getIdentity(ctx);
    if (!identity) {
      throw new ConvexError('Authentication required');
    }

    // Validate Salt Edge configuration
    validateSaltEdgeConfig();

    try {
      // Delete customer from Salt Edge
      await saltedgeRequest(`/customers/${args.customerId}`, {
        method: 'DELETE',
      });

      return {
        success: true,
        message: 'Customer removed successfully',
      };
    } catch (error) {
      console.error('Error removing Salt Edge customer:', error);
      throw new Error(
        `Failed to remove Salt Edge customer: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
});

/**
 * Query to get or create Salt Edge customer for a workspace
 * Returns existing customer ID if found, otherwise creates a new customer
 */
export const getOrCreateCustomer = action({
  args: {},
  handler: async (ctx): Promise<{ customerId: string; isNew: boolean }> => {
    // Verify authentication
    const identity = await getIdentity(ctx);
    if (!identity) {
      throw new ConvexError('Authentication required');
    }

    const orgId = (identity as { org_id?: string }).org_id;
    if (!orgId) {
      throw new ConvexError('No workspace selected');
    }

    // Note: This function needs to be updated to accept workspaceId as an argument
    // For now, throw an error to indicate it needs to be updated
    throw new ConvexError('getOrCreateCustomer needs to be updated to accept workspaceId as an argument');
  },
});

/**
 * Internal query to get customer by org
 * NOTE: SaltEdge support has been removed - this function is no longer functional
 */
export const getCustomerByWorkspaceInternal = internalQuery({
  args: { workspaceId: v.id('workspace') },
  handler: async (ctx, { workspaceId }) => {
    // SaltEdge support has been removed - saltEdgeCustomer table no longer exists
    // Return null to indicate no customer found
    return null;
  },
});

/**
 * Internal mutation to store customer
 * NOTE: SaltEdge support has been removed - this function is no longer functional
 */
export const storeCustomerInternal = internalMutation({
  args: {
    customerId: v.string(),
    workspaceId: v.id('workspace'),
  },
  handler: async (ctx, { customerId, workspaceId }) => {
    // SaltEdge support has been removed - saltEdgeCustomer table no longer exists
    // This function is a no-op
    console.warn('storeCustomerInternal called but SaltEdge support has been removed');
  },
});
