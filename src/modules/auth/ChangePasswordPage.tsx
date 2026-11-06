import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { z } from 'zod'
import { PASSWORD_MIN_LENGTH, defaultAuthenticatedPath } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { changeOwnPassword } from '@/services/api/staff'
import { callableErrorKey } from '@/services/errors'

export function ChangePasswordPage() {
  const { t } = useTranslation()
  const { status, profile, role, refreshProfile, signOutUser } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const schema = z
    .object({
      currentPassword: z.string().min(1, t('validation.passwordRequired')),
      newPassword: z.string().min(PASSWORD_MIN_LENGTH, t('validation.passwordShort')),
      confirmPassword: z.string().min(1, t('validation.passwordRequired')),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      message: t('validation.passwordMismatch'),
      path: ['confirmPassword'],
    })

  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  if (status === 'anonymous') return <Navigate to="/login" replace />
  if (status === 'authenticated' && profile && role && !profile.mustChangePassword) {
    return <Navigate to={defaultAuthenticatedPath(role, profile.permissions)} replace />
  }

  return (
    <PageContainer className="max-w-md">
      <PageHeader title={t('auth.changePasswordTitle')} description={t('auth.changePasswordBody')} />
      <form
        className="space-y-5 rounded-xl border border-border bg-card p-4"
        method="post"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          try {
            await changeOwnPassword({
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            })
            await refreshProfile()
          } catch (caught) {
            setError(t(callableErrorKey(caught)))
          }
        })}
        noValidate
      >
        <FormField
          label={t('auth.currentPassword')}
          htmlFor="current-password"
          error={form.formState.errors.currentPassword?.message}
        >
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
        </FormField>
        <FormField
          label={t('auth.newPassword')}
          htmlFor="new-password"
          error={form.formState.errors.newPassword?.message}
        >
          <Input id="new-password" type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </FormField>
        <FormField
          label={t('auth.confirmPassword')}
          htmlFor="confirm-password"
          error={form.formState.errors.confirmPassword?.message}
        >
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            {...form.register('confirmPassword')}
          />
        </FormField>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isValid}>
            {form.formState.isSubmitting ? t('common.loading') : t('auth.savePassword')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void signOutUser()}>
            {t('auth.signOut')}
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
