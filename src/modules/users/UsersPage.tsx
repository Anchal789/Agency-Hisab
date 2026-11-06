import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { formatPhoneForDisplay, normalizeIndianMobile, PhoneValidationError } from '@shared/auth/phone'
import {
  emptyPermissions,
  normalizePermissions,
  PASSWORD_MIN_LENGTH,
  STAFF_PERMISSION_KEYS,
  type PermissionMap,
} from '@shared/rules/permissions'
import { filterUsers } from '@shared/users/search'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { FilterPanel } from '@/components/forms/FilterPanel'
import { FormField } from '@/components/forms/FormField'
import { FormSection } from '@/components/forms/FormSection'
import { SearchInput } from '@/components/forms/SearchInput'
import { DataTable, type DataColumn } from '@/components/tables/DataTable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createStaffAccount, resetStaffPassword, updateStaffAccount } from '@/services/api/staff'
import { callableErrorKey } from '@/services/errors'
import { getFirebase } from '@/services/firebase/client'
import { permissionLabelKey } from '@/utils/permission-label'

type ListedUser = {
  uid: string
  phoneE164: string
  displayName: string
  role: 'admin' | 'staff'
  status: 'active' | 'disabled'
  permissions: PermissionMap
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
}

function PermissionCheckboxes({
  value,
  onChange,
}: {
  value: PermissionMap
  onChange: (next: PermissionMap) => void
}) {
  const { t } = useTranslation()
  return (
    <FormSection title={t('users.permissions')} description={t('users.permissionsHint')}>
      {STAFF_PERMISSION_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={value[key] === true}
            onCheckedChange={(checked) => {
              onChange({ ...value, [key]: checked === true })
            }}
          />
          <span>{t(permissionLabelKey(key))}</span>
        </label>
      ))}
    </FormSection>
  )
}

export function UsersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ListedUser | null>(null)
  const [pendingToggle, setPendingToggle] = useState<ListedUser | null>(null)
  const [resetTarget, setResetTarget] = useState<ListedUser | null>(null)
  const [issuedTempPassword, setIssuedTempPassword] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const snapshot = await getDocs(query(collection(getFirebase().db, 'users'), orderBy('displayName')))
      return snapshot.docs.map((docSnap) => {
        const data = docSnap.data()
        return {
          uid: docSnap.id,
          phoneE164: typeof data.phoneE164 === 'string' ? data.phoneE164 : '',
          displayName: typeof data.displayName === 'string' ? data.displayName : '',
          role: data.role === 'admin' ? 'admin' : 'staff',
          status: data.status === 'disabled' ? 'disabled' : 'active',
          permissions: normalizePermissions(data.permissions),
        } satisfies ListedUser
      })
    },
  })

  const createSchema = z.object({
    displayName: z.string().trim().min(2, t('validation.nameRequired')),
    phone: z
      .string()
      .trim()
      .min(1, t('validation.phoneRequired'))
      .superRefine((value, ctx) => {
        try {
          normalizeIndianMobile(value)
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof PhoneValidationError ? t('validation.phoneInvalid') : t('validation.phoneInvalid'),
          })
        }
      }),
    password: z.string().min(PASSWORD_MIN_LENGTH, t('validation.passwordShort')),
    permissions: z.custom<PermissionMap>(),
  })

  const editSchema = z.object({
    permissions: z.custom<PermissionMap>(),
  })

  const createForm = useForm({
    resolver: zodResolver(createSchema),
    mode: 'onChange',
    defaultValues: {
      displayName: '',
      phone: '',
      password: '',
      permissions: emptyPermissions(),
    },
  })

  const editForm = useForm({
    resolver: zodResolver(editSchema),
    mode: 'onChange',
    defaultValues: {
      permissions: emptyPermissions(),
    },
  })

  useEffect(() => {
    if (!editTarget) return
    editForm.reset({ permissions: { ...emptyPermissions(), ...editTarget.permissions } })
  }, [editTarget, editForm])

  const createMutation = useMutation({
    mutationFn: createStaffAccount,
    onSuccess: async () => {
      toast.success(t('users.created'))
      setCreateOpen(false)
      createForm.reset({ displayName: '', phone: '', password: '', permissions: emptyPermissions() })
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      toast.error(t(callableErrorKey(error)))
    },
  })

  const editMutation = useMutation({
    mutationFn: updateStaffAccount,
    onSuccess: async () => {
      toast.success(t('users.permissionsUpdated'))
      setEditTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      toast.error(t(callableErrorKey(error)))
    },
  })

  const toggleMutation = useMutation({
    mutationFn: updateStaffAccount,
    onSuccess: async () => {
      toast.success(t('users.accessUpdated'))
      setPendingToggle(null)
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      toast.error(t(callableErrorKey(error)))
    },
  })

  const resetMutation = useMutation({
    mutationFn: resetStaffPassword,
    onSuccess: async (_data, variables) => {
      setIssuedTempPassword(variables.temporaryPassword)
      toast.success(t('users.passwordReset'))
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      toast.error(t(callableErrorKey(error)))
    },
  })

  const filtered = useMemo(
    () => filterUsers(usersQuery.data ?? [], { search, status: statusFilter }),
    [search, statusFilter, usersQuery.data],
  )

  const columns: Array<DataColumn<ListedUser>> = [
    { id: 'name', header: t('table.name'), cell: (row) => row.displayName },
    {
      id: 'phone',
      header: t('table.phone'),
      cell: (row) => (row.phoneE164 ? formatPhoneForDisplay(row.phoneE164) : '—'),
    },
    {
      id: 'role',
      header: t('table.role'),
      cell: (row) => (row.role === 'admin' ? t('account.admin') : t('account.staff')),
    },
    {
      id: 'status',
      header: t('table.status'),
      cell: (row) => (
        <StatusBadge tone={row.status === 'active' ? 'success' : 'danger'}>
          {row.status === 'active' ? t('account.active') : t('account.disabled')}
        </StatusBadge>
      ),
    },
    {
      id: 'actions',
      header: t('table.actions'),
      cell: (row) => {
        if (row.role !== 'staff') return null
        return (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditTarget(row)} data-testid="edit-permissions">
              {t('users.editPermissions')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPendingToggle(row)}>
              {row.status === 'active' ? t('users.disable') : t('users.enable')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIssuedTempPassword(null)
                setResetTarget(row)
              }}
            >
              {t('users.resetPassword')}
            </Button>
          </div>
        )
      },
    },
  ]

  const createPermissions = createForm.watch('permissions')
  const editPermissions = editForm.watch('permissions')

  return (
    <PageContainer>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="add-staff">
            {t('users.add')}
          </Button>
        }
      />
      <FilterPanel
        onClear={() => {
          setSearch('')
          setStatusFilter('all')
        }}
      >
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('users.search')} />
        <FormField label={t('users.statusFilter')} htmlFor="status-filter">
          <select
            id="status-filter"
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm transition-[border-color,box-shadow,background-color] hover:border-primary/35 hover:bg-muted/30 focus-visible:border-ring focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_28%,transparent)]"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'disabled')}
          >
            <option value="all">{t('users.allStatuses')}</option>
            <option value="active">{t('account.active')}</option>
            <option value="disabled">{t('account.disabled')}</option>
          </select>
        </FormField>
      </FilterPanel>
      <div className="mt-4">
        <DataTable data={filtered} columns={columns} rowKey={(row) => row.uid} />
        {!usersQuery.isLoading && filtered.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t('users.empty')}</p> : null}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) createForm.reset({ displayName: '', phone: '', password: '', permissions: emptyPermissions() })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.createTitle')}</DialogTitle>
            <DialogDescription>{t('users.createBody')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            method="post"
            onSubmit={createForm.handleSubmit((values) => {
              createMutation.mutate({
                displayName: values.displayName,
                phone: values.phone,
                password: values.password,
                permissions: normalizePermissions(values.permissions),
              })
            })}
            noValidate
          >
            <FormField label={t('users.name')} htmlFor="staff-name" error={createForm.formState.errors.displayName?.message}>
              <Input id="staff-name" {...createForm.register('displayName')} />
            </FormField>
            <FormField label={t('auth.phone')} htmlFor="staff-phone" error={createForm.formState.errors.phone?.message}>
              <Input id="staff-phone" type="tel" inputMode="tel" autoComplete="tel" {...createForm.register('phone')} />
            </FormField>
            <FormField label={t('auth.password')} htmlFor="staff-password" error={createForm.formState.errors.password?.message}>
              <Input id="staff-password" type="password" autoComplete="new-password" {...createForm.register('password')} />
            </FormField>
            <PermissionCheckboxes
              value={createPermissions}
              onChange={(next) => createForm.setValue('permissions', next, { shouldDirty: true, shouldValidate: true })}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !createForm.formState.isValid}>
                {createMutation.isPending ? t('common.loading') : t('users.add')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.editPermissionsTitle')}</DialogTitle>
            <DialogDescription>
              {editTarget ? t('users.editPermissionsBody', { name: editTarget.displayName }) : t('users.permissionsHint')}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            method="post"
            onSubmit={editForm.handleSubmit((values) => {
              if (!editTarget) return
              editMutation.mutate({
                uid: editTarget.uid,
                permissions: normalizePermissions(values.permissions),
              })
            })}
            noValidate
          >
            <PermissionCheckboxes
              value={editPermissions}
              onChange={(next) => editForm.setValue('permissions', next, { shouldDirty: true, shouldValidate: true })}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={editMutation.isPending || !editForm.formState.isDirty}>
                {editMutation.isPending ? t('common.loading') : t('users.savePermissions')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={Boolean(pendingToggle)}
        title={pendingToggle?.status === 'active' ? t('users.disableTitle') : t('users.enableTitle')}
        description={pendingToggle?.status === 'active' ? t('users.disableBody') : t('users.enableBody')}
        destructive={pendingToggle?.status === 'active'}
        pending={toggleMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingToggle(null)
        }}
        onConfirm={() => {
          if (!pendingToggle) return
          toggleMutation.mutate({
            uid: pendingToggle.uid,
            status: pendingToggle.status === 'active' ? 'disabled' : 'active',
          })
        }}
      />

      <Dialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null)
            setIssuedTempPassword(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.resetPasswordTitle')}</DialogTitle>
            <DialogDescription>{t('users.resetPasswordBody')}</DialogDescription>
          </DialogHeader>
          {issuedTempPassword ? (
            <div className="space-y-3">
              <p className="text-sm">{t('users.tempPasswordIssued')}</p>
              <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{issuedTempPassword}</p>
              <p className="text-xs text-muted-foreground">{t('users.tempPasswordHint')}</p>
              <Button
                onClick={() => {
                  setResetTarget(null)
                  setIssuedTempPassword(null)
                }}
              >
                {t('common.close')}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResetTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                disabled={resetMutation.isPending || !resetTarget}
                onClick={() => {
                  if (!resetTarget) return
                  const temporaryPassword = generateTemporaryPassword()
                  resetMutation.mutate({ uid: resetTarget.uid, temporaryPassword })
                }}
              >
                {resetMutation.isPending ? t('common.loading') : t('users.resetPassword')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
