import type { OpeningSessionState } from '../models/finance'

/**
 * What the finish/publish button may call for the current opening session state.
 * Architecture: staging writes only in `preparing`; publish only from `ready_to_publish`.
 * There is no ready → preparing transition — edits after ready require abandon.
 */
export type OpeningPublishActionPlan = 'build_ready_publish' | 'publish_only' | 'blocked'

export function openingPublishActionPlan(sessionState: OpeningSessionState | string | null | undefined): OpeningPublishActionPlan {
  if (sessionState === 'preparing') return 'build_ready_publish'
  if (sessionState === 'ready_to_publish') return 'publish_only'
  return 'blocked'
}

/** Staging mutations (balances, plan, chunks, reviews, rollup) are only valid while preparing. */
export function openingAllowsStagingEdits(sessionState: OpeningSessionState | string | null | undefined): boolean {
  return sessionState === 'preparing' || sessionState == null || sessionState === ''
}

export function openingStagingBlockedMessage(sessionState: string): string {
  if (sessionState === 'ready_to_publish') {
    return 'Setup is ready to publish. Finish publishing, or cancel setup before changing balances or preparation steps.'
  }
  if (sessionState === 'published') {
    return 'Financial opening is already published.'
  }
  if (sessionState === 'abandoned') {
    return 'This opening session was cancelled. Start a new setup.'
  }
  return `Opening session state must be preparing (current: ${sessionState}).`
}
