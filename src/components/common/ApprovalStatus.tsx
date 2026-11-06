import { useTranslation } from 'react-i18next'
import { StatusBadge } from './StatusBadge'

const tones = {
  not_required: 'info',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const

export function ApprovalStatus({ status }: { status: keyof typeof tones }) {
  const { t } = useTranslation()
  return <StatusBadge tone={tones[status]}>{t(`approval.${status}`)}</StatusBadge>
}
