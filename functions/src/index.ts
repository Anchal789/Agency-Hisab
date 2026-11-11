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
import { manageAgencyConfig } from './settings/manage-agency-config'

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
}
