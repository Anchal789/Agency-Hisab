import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { z } from 'zod'
import { defaultAuthenticatedPath } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { Mark } from '@/components/brand/Mark'
import { LoadingState } from '@/components/common/LoadingState'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setDocumentLanguage } from '@/i18n'
import i18n from '@/i18n'
import { authErrorKey } from '@/services/errors'

export function LoginPage() {
  const { t } = useTranslation()
  const { status, profile, role, signIn } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const schema = z.object({
    username: z.string().trim().min(1, t('validation.phoneRequired')),
    password: z.string().min(1, t('validation.passwordRequired')),
  })
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { username: '', password: '' },
  })

  if (status === 'loading') return <LoadingState />
  if (status === 'authenticated') {
    if (profile?.mustChangePassword) return <Navigate to="/change-password" replace />
    if (role && profile) return <Navigate to={defaultAuthenticatedPath(role, profile.permissions)} replace />
    return <Navigate to="/" replace />
  }
  if (status === 'unprovisioned' || status === 'disabled') return <Navigate to="/access-denied" replace />

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden bg-sidebar px-12 py-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <Mark className="h-10 w-10" />
          <div>
            <p className="font-semibold">{t('appName')}</p>
            <p className="text-sm text-sidebar-muted">{t('agencyName')}</p>
          </div>
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-semibold tracking-tight text-white">{t('auth.welcome')}</h1>
          <p className="mt-4 max-w-md text-base text-sidebar-muted">{t('auth.welcomeBody')}</p>
        </div>
        <p className="text-sm text-sidebar-muted">{t('auth.noPublicSignup')}</p>
      </section>
      <section className="flex flex-col px-5 py-6">
        <div className="mb-8 flex items-center justify-between lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <Mark className="h-9 w-9" />
            <span className="font-semibold">{t('appName')}</span>
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            {(['en', 'hi'] as const).map((language) => (
              <button
                key={language}
                type="button"
                className={`rounded px-2 py-1 text-xs font-semibold ${i18n.language === language ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                onClick={() => {
                  void i18n.changeLanguage(language)
                  setDocumentLanguage(language)
                }}
              >
                {language === 'en' ? 'EN' : 'हि'}
              </button>
            ))}
          </div>
        </div>
        <form
          className="mx-auto w-full max-w-sm flex-1"
          method="post"
          onSubmit={form.handleSubmit(async (values) => {
            setFormError(null)
            try {
              await signIn(values.username, values.password)
            } catch (error) {
              setFormError(t(authErrorKey(error)))
            }
          })}
          noValidate
        >
          <h2 className="text-2xl font-semibold lg:mt-16">{t('auth.signIn')}</h2>
          <p className="mt-2 text-sm text-muted-foreground lg:hidden">{t('auth.noPublicSignup')}</p>
          <div className="mt-6 space-y-5">
            <FormField label={t('auth.phone')} htmlFor="username" error={form.formState.errors.username?.message}>
              <Input
                id="username"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                data-testid="login-phone"
                {...form.register('username')}
              />
            </FormField>
            <FormField
              label={t('auth.password')}
              htmlFor="password"
              error={form.formState.errors.password?.message}
              labelAside={
                <Link to="/forgot-password" className="text-xs font-semibold text-accent">
                  {t('auth.forgot')}
                </Link>
              }
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                data-testid="login-password"
                {...form.register('password')}
              />
            </FormField>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={form.formState.isSubmitting || !form.formState.isValid}
              data-testid="login-submit"
            >
              {form.formState.isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
