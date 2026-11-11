import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatPaise, rupeesToPaise } from '@shared/models/money'
import {
  newConfigId,
  parseAgencySettings,
  parseLocation,
  parsePriceRule,
  parseProduct,
  PAYMENT_CATEGORIES,
  type LocationDoc,
  type PaymentCategory,
  type PaymentMethod,
  type PriceRuleDoc,
  type ProductDoc,
  type ReceivingAccount,
} from '@shared/models/agency-config'
import { useAuth } from '@/app/providers/AuthProvider'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { FormField } from '@/components/forms/FormField'
import { FormSection } from '@/components/forms/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setDocumentLanguage } from '@/i18n'
import i18n from '@/i18n'
import { manageAgencyConfig } from '@/services/api/agency-settings'
import { callableErrorMessage } from '@/services/errors'
import { getFirebase } from '@/services/firebase/client'

type DraftNamed = { id?: string; name: string; kind: PaymentCategory }
type DraftAccount = { id?: string; name: string; kind: PaymentCategory }
type DraftLocation = { id?: string; name: string; kind: 'godown' | 'other' }
type DraftProduct = { id?: string; name: string; code: string; kind: 'cylinder' | 'accessory' | 'other'; unit: string }
type DraftPrice = { id?: string; productId: string; label: string; amountRupees: string }

export function SettingsPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [agencyName, setAgencyName] = useState('')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [currency, setCurrency] = useState('INR')
  const [methodDraft, setMethodDraft] = useState<DraftNamed>({ name: '', kind: 'cash' })
  const [accountDraft, setAccountDraft] = useState<DraftAccount>({ name: '', kind: 'cash' })
  const [locationDraft, setLocationDraft] = useState<DraftLocation>({ name: '', kind: 'godown' })
  const [productDraft, setProductDraft] = useState<DraftProduct>({
    name: '',
    code: '',
    kind: 'cylinder',
    unit: 'cylinder',
  })
  const [priceDraft, setPriceDraft] = useState<DraftPrice>({ productId: '', label: '', amountRupees: '' })
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: 'method' | 'account'; id: string; name: string }
    | { type: 'location' | 'product' | 'price'; id: string; name: string }
    | null
  >(null)

  const agencyQuery = useQuery({
    queryKey: ['settings', 'agency'],
    queryFn: async () => {
      const snapshot = await getDoc(doc(getFirebase().db, 'settings', 'agency'))
      if (!snapshot.exists()) throw new Error('missing-agency')
      const parsed = parseAgencySettings(snapshot.data() as Record<string, unknown>)
      setAgencyName(parsed.name)
      setTimezone(parsed.timezone)
      setCurrency(parsed.currency)
      return parsed
    },
  })

  const locationsQuery = useQuery({
    queryKey: ['settings', 'locations'],
    queryFn: async () => {
      const snapshot = await getDocs(query(collection(getFirebase().db, 'locations'), orderBy('name')))
      return snapshot.docs
        .map((row) => parseLocation(row.id, row.data() as Record<string, unknown>))
        .filter((row): row is LocationDoc => row !== null)
    },
  })

  const productsQuery = useQuery({
    queryKey: ['settings', 'products'],
    queryFn: async () => {
      const snapshot = await getDocs(query(collection(getFirebase().db, 'products'), orderBy('name')))
      return snapshot.docs
        .map((row) => parseProduct(row.id, row.data() as Record<string, unknown>))
        .filter((row): row is ProductDoc => row !== null)
    },
  })

  const pricesQuery = useQuery({
    queryKey: ['settings', 'priceRules'],
    queryFn: async () => {
      const snapshot = await getDocs(collection(getFirebase().db, 'priceRules'))
      return snapshot.docs
        .map((row) => parsePriceRule(row.id, row.data() as Record<string, unknown>))
        .filter((row): row is PriceRuleDoc => row !== null)
    },
  })

  const configMutation = useMutation({
    mutationFn: manageAgencyConfig,
    onSuccess: async () => {
      toast.success(t('settings.configSaved'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', 'agency'] }),
        queryClient.invalidateQueries({ queryKey: ['settings', 'locations'] }),
        queryClient.invalidateQueries({ queryKey: ['settings', 'products'] }),
        queryClient.invalidateQueries({ queryKey: ['settings', 'priceRules'] }),
        queryClient.invalidateQueries({ queryKey: ['godown-config'] }),
      ])
      setMethodDraft({ name: '', kind: 'cash' })
      setAccountDraft({ name: '', kind: 'cash' })
      setLocationDraft({ name: '', kind: 'godown' })
      setProductDraft({ name: '', code: '', kind: 'cylinder', unit: 'cylinder' })
      setPriceDraft({ productId: '', label: '', amountRupees: '' })
      setDeleteTarget(null)
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })

  const productNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const product of productsQuery.data ?? []) map.set(product.id, product.name)
    return map
  }, [productsQuery.data])

  async function switchLanguage(language: 'en' | 'hi') {
    try {
      await i18n.changeLanguage(language)
      setDocumentLanguage(language)
      if (profile) {
        await updateDoc(doc(getFirebase().db, 'users', profile.uid), { language, updatedAt: serverTimestamp() })
      }
      toast.success(t('settings.languageSaved'))
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  function saveNamedList(kind: 'payment' | 'receiving', items: PaymentMethod[] | ReceivingAccount[]) {
    if (kind === 'payment') {
      configMutation.mutate({ action: 'setPaymentMethods', payload: { items: items as PaymentMethod[] } })
      return
    }
    configMutation.mutate({ action: 'setReceivingAccounts', payload: { items: items as ReceivingAccount[] } })
  }

  function upsertNamed(
    kind: 'payment' | 'receiving',
    draft: DraftNamed | DraftAccount,
    existing: PaymentMethod[] | ReceivingAccount[],
  ) {
    const name = draft.name.trim()
    if (name.length < 1) {
      toast.error(t('validation.nameRequired'))
      return
    }
    const id = draft.id ?? newConfigId(kind === 'payment' ? 'pm' : 'ra')
    const duplicate = existing.some((item) => item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase())
    if (duplicate) {
      toast.error(t('settings.duplicateName'))
      return
    }
    if (kind === 'payment') {
      const methodDraftValue = draft as DraftNamed
      const next = [
        ...(existing as PaymentMethod[]).filter((item) => item.id !== id),
        { id, name, kind: methodDraftValue.kind, active: true },
      ]
      saveNamedList('payment', next)
      return
    }
    const accountDraftValue = draft as DraftAccount
    const next = [
      ...(existing as ReceivingAccount[]).filter((item) => item.id !== id),
      { id, name, kind: accountDraftValue.kind, active: true },
    ]
    saveNamedList('receiving', next)
  }

  const agency = agencyQuery.data
  const loading = agencyQuery.isLoading || locationsQuery.isLoading || productsQuery.isLoading || pricesQuery.isLoading
  const errored = agencyQuery.isError || locationsQuery.isError || productsQuery.isError || pricesQuery.isError

  return (
    <PageContainer>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      {loading ? <LoadingState /> : null}
      {errored ? <ErrorState title={t('errors.generic')} description={t('settings.loadFailed')} /> : null}

      {!loading && !errored && agency ? (
        <div className="space-y-4">
          <FormSection title={t('settings.languageTitle')} description={t('settings.languageBody')}>
            <div className="flex gap-2">
              <Button
                variant={i18n.language === 'en' ? 'primary' : 'outline'}
                onClick={() => void switchLanguage('en')}
                data-testid="settings-lang-en"
              >
                {t('language.en')}
              </Button>
              <Button
                variant={i18n.language === 'hi' ? 'primary' : 'outline'}
                onClick={() => void switchLanguage('hi')}
                data-testid="settings-lang-hi"
              >
                {t('language.hi')}
              </Button>
            </div>
          </FormSection>

          <FormSection title={t('settings.agencyTitle')} description={t('settings.agencyBody')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('settings.agencyName')} htmlFor="agency-name">
                <Input id="agency-name" value={agencyName} onChange={(event) => setAgencyName(event.target.value)} />
              </FormField>
              <FormField label={t('settings.timezone')} htmlFor="agency-timezone">
                <select
                  id="agency-timezone"
                  className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  <option value="Asia/Kolkata">Asia/Kolkata</option>
                </select>
              </FormField>
              <FormField label={t('settings.currency')} htmlFor="agency-currency">
                <select
                  id="agency-currency"
                  className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  <option value="INR">INR</option>
                </select>
              </FormField>
            </div>
            <Button
              className="mt-4"
              disabled={configMutation.isPending || agencyName.trim().length < 2}
              onClick={() =>
                configMutation.mutate({
                  action: 'updateProfile',
                  payload: { name: agencyName.trim(), timezone: timezone as 'Asia/Kolkata', currency: currency as 'INR' },
                })
              }
            >
              {t('settings.saveAgency')}
            </Button>
          </FormSection>

          <FormSection title={t('settings.paymentMethodsTitle')} description={t('settings.paymentMethodsBody')}>
            <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
              <Input
                value={methodDraft.name}
                onChange={(event) => setMethodDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={t('settings.itemName')}
              />
              <select
                className="h-11 rounded-md border border-input bg-card px-3 text-sm"
                value={methodDraft.kind}
                onChange={(event) =>
                  setMethodDraft((current) => ({ ...current, kind: event.target.value as PaymentCategory }))
                }
              >
                {PAYMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(`settings.accountKinds.${category}`)}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button
                  disabled={configMutation.isPending || methodDraft.name.trim().length < 1}
                  onClick={() => upsertNamed('payment', methodDraft, agency.paymentMethods)}
                >
                  {methodDraft.id ? t('common.save') : t('common.add')}
                </Button>
                {methodDraft.id ? (
                  <Button variant="outline" onClick={() => setMethodDraft({ name: '', kind: 'cash' })}>
                    {t('common.cancel')}
                  </Button>
                ) : null}
              </div>
            </div>
            {agency.paymentMethods.length === 0 ? (
              <EmptyState title={t('settings.emptyMethods')} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {agency.paymentMethods.map((item) => (
                  <ConfigRow
                    key={item.id}
                    title={`${item.name} · ${t(`settings.accountKinds.${item.kind}`)}`}
                    onEdit={() => setMethodDraft({ id: item.id, name: item.name, kind: item.kind })}
                    onDelete={() => setDeleteTarget({ type: 'method', id: item.id, name: item.name })}
                  />
                ))}
              </ul>
            )}
          </FormSection>

          <FormSection title={t('settings.receivingAccountsTitle')} description={t('settings.receivingAccountsBody')}>
            <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
              <Input
                value={accountDraft.name}
                onChange={(event) => setAccountDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={t('settings.itemName')}
              />
              <select
                className="h-11 rounded-md border border-input bg-card px-3 text-sm"
                value={accountDraft.kind}
                onChange={(event) =>
                  setAccountDraft((current) => ({ ...current, kind: event.target.value as PaymentCategory }))
                }
              >
                {PAYMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(`settings.accountKinds.${category}`)}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button
                  disabled={configMutation.isPending || accountDraft.name.trim().length < 1}
                  onClick={() => upsertNamed('receiving', accountDraft, agency.receivingAccounts)}
                >
                  {accountDraft.id ? t('common.save') : t('common.add')}
                </Button>
                {accountDraft.id ? (
                  <Button variant="outline" onClick={() => setAccountDraft({ name: '', kind: 'cash' })}>
                    {t('common.cancel')}
                  </Button>
                ) : null}
              </div>
            </div>
            {agency.receivingAccounts.length === 0 ? (
              <EmptyState title={t('settings.emptyAccounts')} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {agency.receivingAccounts.map((item) => (
                  <ConfigRow
                    key={item.id}
                    title={`${item.name} · ${t(`settings.accountKinds.${item.kind}`)}`}
                    onEdit={() => setAccountDraft({ id: item.id, name: item.name, kind: item.kind })}
                    onDelete={() => setDeleteTarget({ type: 'account', id: item.id, name: item.name })}
                  />
                ))}
              </ul>
            )}
          </FormSection>

          <FormSection title={t('settings.locationsTitle')} description={t('settings.locationsBody')}>
            <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
              <Input
                value={locationDraft.name}
                onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={t('settings.itemName')}
              />
              <select
                className="h-11 rounded-md border border-input bg-card px-3 text-sm"
                value={locationDraft.kind}
                onChange={(event) =>
                  setLocationDraft((current) => ({ ...current, kind: event.target.value as 'godown' | 'other' }))
                }
              >
                <option value="godown">{t('settings.locationKinds.godown')}</option>
                <option value="other">{t('settings.locationKinds.other')}</option>
              </select>
              <Button
                disabled={configMutation.isPending || locationDraft.name.trim().length < 2}
                onClick={() =>
                  configMutation.mutate({
                    action: 'upsertLocation',
                    payload: {
                      ...(locationDraft.id ? { id: locationDraft.id } : {}),
                      name: locationDraft.name.trim(),
                      kind: locationDraft.kind,
                      active: true,
                    },
                  })
                }
              >
                {locationDraft.id ? t('common.save') : t('common.add')}
              </Button>
            </div>
            {(locationsQuery.data ?? []).length === 0 ? (
              <EmptyState title={t('settings.emptyLocations')} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(locationsQuery.data ?? []).map((item) => (
                  <ConfigRow
                    key={item.id}
                    title={`${item.name} · ${t(`settings.locationKinds.${item.kind}`)}`}
                    badge={item.active ? t('account.active') : t('account.disabled')}
                    onEdit={() => setLocationDraft({ id: item.id, name: item.name, kind: item.kind })}
                    onDelete={() => setDeleteTarget({ type: 'location', id: item.id, name: item.name })}
                  />
                ))}
              </ul>
            )}
          </FormSection>

          <FormSection title={t('settings.productsTitle')} description={t('settings.productsBody')}>
            <div className="mb-3 grid gap-3 lg:grid-cols-4">
              <Input
                value={productDraft.name}
                onChange={(event) => setProductDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={t('settings.itemName')}
              />
              <Input
                value={productDraft.code}
                onChange={(event) => setProductDraft((current) => ({ ...current, code: event.target.value }))}
                placeholder={t('settings.productCode')}
              />
              <select
                className="h-11 rounded-md border border-input bg-card px-3 text-sm"
                value={productDraft.kind}
                onChange={(event) =>
                  setProductDraft((current) => ({
                    ...current,
                    kind: event.target.value as DraftProduct['kind'],
                  }))
                }
              >
                <option value="cylinder">{t('settings.productKinds.cylinder')}</option>
                <option value="accessory">{t('settings.productKinds.accessory')}</option>
                <option value="other">{t('settings.productKinds.other')}</option>
              </select>
              <Button
                disabled={
                  configMutation.isPending || productDraft.name.trim().length < 2 || productDraft.code.trim().length < 1
                }
                onClick={() =>
                  configMutation.mutate({
                    action: 'upsertProduct',
                    payload: {
                      ...(productDraft.id ? { id: productDraft.id } : {}),
                      name: productDraft.name.trim(),
                      code: productDraft.code.trim(),
                      kind: productDraft.kind,
                      unit: productDraft.unit.trim() || 'cylinder',
                      active: true,
                    },
                  })
                }
              >
                {productDraft.id ? t('common.save') : t('common.add')}
              </Button>
            </div>
            {(productsQuery.data ?? []).length === 0 ? (
              <EmptyState title={t('settings.emptyProducts')} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(productsQuery.data ?? []).map((item) => (
                  <ConfigRow
                    key={item.id}
                    title={`${item.name} (${item.code})`}
                    badge={t(`settings.productKinds.${item.kind}`)}
                    onEdit={() =>
                      setProductDraft({
                        id: item.id,
                        name: item.name,
                        code: item.code,
                        kind: item.kind,
                        unit: item.unit,
                      })
                    }
                    onDelete={() => setDeleteTarget({ type: 'product', id: item.id, name: item.name })}
                  />
                ))}
              </ul>
            )}
          </FormSection>

          <FormSection title={t('settings.pricesTitle')} description={t('settings.pricesBody')}>
            <div className="mb-3 grid gap-3 lg:grid-cols-4">
              <select
                className="h-11 rounded-md border border-input bg-card px-3 text-sm"
                value={priceDraft.productId}
                onChange={(event) => setPriceDraft((current) => ({ ...current, productId: event.target.value }))}
              >
                <option value="">{t('settings.selectProduct')}</option>
                {(productsQuery.data ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
              <Input
                value={priceDraft.label}
                onChange={(event) => setPriceDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder={t('settings.priceLabel')}
              />
              <Input
                value={priceDraft.amountRupees}
                onChange={(event) => setPriceDraft((current) => ({ ...current, amountRupees: event.target.value }))}
                placeholder={t('settings.amountRupees')}
                inputMode="decimal"
              />
              <Button
                disabled={configMutation.isPending}
                onClick={() => {
                  try {
                    const amountPaise = rupeesToPaise(priceDraft.amountRupees)
                    if (!priceDraft.productId || priceDraft.label.trim().length < 2) {
                      toast.error(t('errors.invalidInput'))
                      return
                    }
                    configMutation.mutate({
                      action: 'upsertPriceRule',
                      payload: {
                        ...(priceDraft.id ? { id: priceDraft.id } : {}),
                        productId: priceDraft.productId,
                        label: priceDraft.label.trim(),
                        amountPaise,
                        active: true,
                      },
                    })
                  } catch {
                    toast.error(t('settings.invalidAmount'))
                  }
                }}
              >
                {priceDraft.id ? t('common.save') : t('common.add')}
              </Button>
            </div>
            {(pricesQuery.data ?? []).length === 0 ? (
              <EmptyState title={t('settings.emptyPrices')} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(pricesQuery.data ?? []).map((item) => (
                  <ConfigRow
                    key={item.id}
                    title={`${item.label} · ${productNameById.get(item.productId) ?? item.productId}`}
                    badge={formatPaise(item.amountPaise, i18n.language === 'hi' ? 'hi' : 'en')}
                    onEdit={() =>
                      setPriceDraft({
                        id: item.id,
                        productId: item.productId,
                        label: item.label,
                        amountRupees: (item.amountPaise / 100).toFixed(2),
                      })
                    }
                    onDelete={() => setDeleteTarget({ type: 'price', id: item.id, name: item.label })}
                  />
                ))}
              </ul>
            )}
          </FormSection>
        </div>
      ) : null}

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title={t('settings.deleteTitle')}
        description={t('settings.deleteBody', { name: deleteTarget?.name ?? '' })}
        destructive
        pending={configMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={() => {
          if (!deleteTarget || !agency) return
          if (deleteTarget.type === 'method') {
            saveNamedList(
              'payment',
              agency.paymentMethods.filter((item) => item.id !== deleteTarget.id),
            )
            return
          }
          if (deleteTarget.type === 'account') {
            saveNamedList(
              'receiving',
              agency.receivingAccounts.filter((item) => item.id !== deleteTarget.id),
            )
            return
          }
          if (deleteTarget.type === 'location') {
            configMutation.mutate({ action: 'deleteLocation', payload: { id: deleteTarget.id } })
            return
          }
          if (deleteTarget.type === 'product') {
            configMutation.mutate({ action: 'deleteProduct', payload: { id: deleteTarget.id } })
            return
          }
          configMutation.mutate({ action: 'deletePriceRule', payload: { id: deleteTarget.id } })
        }}
      />
    </PageContainer>
  )
}

function ConfigRow({
  title,
  badge,
  onEdit,
  onDelete,
}: {
  title: string
  badge?: string
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {badge ? (
          <div className="mt-1">
            <StatusBadge tone="info">{badge}</StatusBadge>
          </div>
        ) : null}
      </div>
      <Button variant="outline" size="sm" onClick={onEdit}>
        {t('common.edit')}
      </Button>
      <Button variant="outline" size="sm" onClick={onDelete}>
        {t('common.delete')}
      </Button>
    </li>
  )
}
