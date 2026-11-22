import { initializeApp } from 'firebase-admin/app'
import { changeOwnPassword } from './auth/change-own-password'
import { createStaffUser } from './auth/create-staff'
import { resetStaffPassword } from './auth/reset-staff-password'
import { updateStaffAccess } from './auth/update-staff'
import { checkCustomerConsumerNumbers, commitCustomerImport } from './customers/import-customers'
import { createCustomer, updateCustomer } from './customers/upsert-customer'
import {
  createGodownSale,
  recordEmptyReturn,
  reverseGodownSale,
  updateGodownSale,
} from './godown/post-godown'
import {
  approveInventoryTransaction,
  createStockOpening,
  createStockReceipt,
  createStockReconciliation,
  createStockReturnToDistributor,
  createStockTransfer,
  rejectInventoryTransaction,
} from './inventory/post-inventory'
import { manageAgencyConfig } from './settings/manage-agency-config'
import {
  abandonFinancialOpeningSeal,
  beginFinancialOpeningSeal,
  buildOpeningRollup,
  getFinancialOpeningStatus,
  listOpeningReviews,
  markOpeningReady,
  materializeOpeningReceivables,
  planFinancialOpening,
  prepareOpeningChunk,
  publishFinancialOpening,
  saveOpeningBalanceSheet,
  verifyOpeningReceivable,
} from './finance/post-opening'
import { resolveHistoricalGodownSaleFinance } from './finance/historical-resolve'
import { releaseFutureDatedTransaction } from './finance/release-future'
import {
  createManualOpeningReceivable,
  createOpeningReceivableAdjustment,
  linkOpeningReceivable,
} from './finance/manual-receivables'

initializeApp()

export {
  changeOwnPassword,
  createStaffUser,
  resetStaffPassword,
  updateStaffAccess,
  manageAgencyConfig,
  createCustomer,
  updateCustomer,
  checkCustomerConsumerNumbers,
  commitCustomerImport,
  createGodownSale,
  updateGodownSale,
  reverseGodownSale,
  recordEmptyReturn,
  createStockOpening,
  createStockReceipt,
  createStockReturnToDistributor,
  createStockTransfer,
  createStockReconciliation,
  approveInventoryTransaction,
  rejectInventoryTransaction,
  beginFinancialOpeningSeal,
  saveOpeningBalanceSheet,
  planFinancialOpening,
  prepareOpeningChunk,
  verifyOpeningReceivable,
  materializeOpeningReceivables,
  buildOpeningRollup,
  markOpeningReady,
  publishFinancialOpening,
  abandonFinancialOpeningSeal,
  listOpeningReviews,
  getFinancialOpeningStatus,
  resolveHistoricalGodownSaleFinance,
  releaseFutureDatedTransaction,
  createManualOpeningReceivable,
  linkOpeningReceivable,
  createOpeningReceivableAdjustment,
}
