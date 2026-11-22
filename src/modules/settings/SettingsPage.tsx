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
  type ReceivingAccountOwnership,
} from '@shared/models/agency-config'
import {
  isDuplicateAmong,
  locationUniquenessKey,
  paymentMethodUniquenessKey,
  priceRuleUniquenessKey,
  productCodeUniquenessKey,
  productNameUniquenessKey,
  receivingAccountUniquenessKey,
} from '@shared/rules/settings-uniqueness'
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

type DraftNamed = { id?: string; name: string; kind: PaymentCategory; active?: boolean }
type DraftAccount = {
  id?: string
  name: string
  kind: PaymentCategory
  active?: boolean
  ownership?: ReceivingAccountOwnership | ''
  compatiblePaymentMethodIds: string[]
}
type DraftLocation = {
  id?: string
  name: string
  kind: 'godown' | 'vehicle' | 'agent' | 'csc' | 'other'
}
type DraftProduct = { id?: string; name: string; code: string; kind: 'cylinder' | 'accessory' | 'other'; unit: string }
type DraftPrice = { id?: string; productId: string; label: string; amountRupees: string }

export function SettingsPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [agencyName, setAgencyName] = useState('')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [currency, setCurrency] = useState('INR')
  const [inventoryCutoverDate, setInventoryCutoverDate] = useState('')
  const [methodDraft, setMethodDraft] = useState<DraftNamed>({ name: '', kind: 'cash', active: true })
  const [accountDraft, setAccountDraft] = useState<DraftAccount>({
    name: '',
    kind: 'cash',
    active: true,
    ownership: '',
    compatiblePaymentMethodIds: [],
  })
  const [locationDraft, setLocationDraft] = useState<DraftLocation>({ name: '', kind: 'godown' })
  const [productDraft, setProductDraft] = useState<DraftProduct>({
    name: '',
    code: '',
    kind: 'cylinder',
    unit: 'cylinder',
  })
  const [priceDraft, setPriceDraft] = useState<DraftPrice>({ productId: '', label: '', amountRupees: '' })
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'location' | 'product' | 'price'
    id: string
    name: string
  } | null>(null)

  const agencyQuery = useQuery({
    queryKey: ['settings', 'agency'],
    queryFn: async () => {
      const snapshot = await getDoc(doc(getFirebase().db, 'settings', 'agency'))
      if (!snapshot.exists()) throw new Error('missing-agency')
      const parsed = parseAgencySettings(snapshot.data() as Record<string, unknown>)
      setAgencyName(parsed.name)
      setTimezone(parsed.timezone)
      setCurrency(parsed.currency)
      setInventoryCutoverDate(parsed.inventoryCutoverDate ?? '')
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
      setMethodDraft({ name: '', kind: 'cash', active: true })
      setAccountDraft({
        name: '',
        kind: 'cash',
        active: true,
        ownership: '',
        compatiblePaymentMethodIds: [],
      })
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
    if (kind === 'payment') {
      const methodDraftValue = draft as DraftNamed
      if (
        isDuplicateAmong(
          existing as PaymentMethod[],
          { id },
          paymentMethodUniquenessKey({ name, kind: methodDraftValue.kind }),
          paymentMethodUniquenessKey,
        )
      ) {
        toast.error(t('settings.duplicateNameCategory'))
        return
      }
      const next = [
        ...(existing as PaymentMethod[]).filter((item) => item.id !== id),
        {
          id,
          name,
          kind: methodDraftValue.kind,
          active: methodDraftValue.active !== false,
        },
      ]
      saveNamedList('payment', next)
      setMethodDraft({ name: '', kind: 'cash', active: true })
      return
    }
    const accountDraftValue = draft as DraftAccount
    if (!accountDraftValue.ownership) {
      toast.error(t('settings.ownershipRequired'))
      return
    }
    if (accountDraftValue.compatiblePaymentMethodIds.length === 0) {
      toast.error(t('settings.compatibleMethodsRequired'))
      return
    }
    if (
      isDuplicateAmong(
        existing as ReceivingAccount[],
        { id },
        receivingAccountUniquenessKey({ name, kind: accountDraftValue.kind }),
        receivingAccountUniquenessKey,
      )
    ) {
      toast.error(t('settings.duplicateNameCategory'))
      return
    }
    const next = [
      ...(existing as ReceivingAccount[]).filter((item) => item.id !== id),
      {
        id,
        name,
        kind: accountDraftValue.kind,
        active: accountDraftValue.active !== false,
        ownership: accountDraftValue.ownership,
        compatiblePaymentMethodIds: accountDraftValue.compatiblePaymentMethodIds,
      },
    ]
    saveNamedList('receiving', next)
    setAccountDraft({
      name: '',
      kind: 'cash',
      active: true,
      ownership: '',
      compatiblePaymentMethodIds: [],
    })
  }

  function setDestinationActive(accountId: string, active: boolean) {
    if (!agency) return
    const next = agency.receivingAccounts.map((item) =>
      item.id === accountId ? { ...item, active } : item,
    )
    saveNamedList('receiving', next)
  }

  function setMethodActive(methodId: string, active: boolean) {
    if (!agency) return
    const next = agency.paymentMethods.map((item) =>
      item.id === methodId ? { ...item, active } : item,
    )
    saveNamedList('payment', next)
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
              <FormField label={t('settings.inventoryCutoverDate')} htmlFor="inventory-cutover">
                <Input
                  id="inventory-cutover"
                  type="date"
                  value={inventoryCutoverDate}
                  onChange={(event) => setInventoryCutoverDate(event.target.value)}
                />
              </FormField>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('settings.inventoryCutoverHint')}</p>
            <Button
              className="mt-4"
              disabled={configMutation.isPending || agencyName.trim().length < 2}
              onClick={() =>
                configMutation.mutate({
                  action: 'updateProfile',
                  payload: {
                    name: agencyName.trim(),
                    timezone: timezone as 'Asia/Kolkata',
                    currency: currency as 'INR',
                    inventoryCutoverDate: inventoryCutoverDate.trim() ? inventoryCutoverDate.trim() : null,
                  },
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
                  <Button
                    variant="outline"
                    onClick={() => setMethodDraft({ name: '', kind: 'cash', active: true })}
                  >
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
                    badge={item.active ? undefined : t('settings.inactive')}
                    onEdit={() =>
                      setMethodDraft({
                        id: item.id,
                        name: item.name,
                        kind: item.kind,
                        active: item.active,
                      })
                    }
                    onDelete={() => setMethodActive(item.id, !item.active)}
                    deleteLabel={item.active ? t('settings.deactivate') : t('settings.activate')}
                  />
                ))}
              </ul>
            )}
          </FormSection>

          <FormSection title={t('settings.receivingAccountsTitle')} description={t('settings.receivingAccountsBody')}>
            <div className="mb-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={accountDraft.name}
                  onChange={(event) => setAccountDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t('settings.destinationName')}
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
                <select
                  className="h-11 rounded-md border border-input bg-card px-3 text-sm"
                  value={accountDraft.ownership}
                  onChange={(event) =>
                    setAccountDraft((current) => ({
                      ...current,
                      ownership: event.target.value as ReceivingAccountOwnership | '',
                    }))
                  }
                >
                  <option value="">{t('settings.ownershipPlaceholder')}</option>
                  <option value="agency">{t('settings.ownership.agency')}</option>
                  <option value="third_party_held">{t('settings.ownership.third_party_held')}</option>
                  <option value="portal">{t('settings.ownership.portal')}</option>
                </select>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">{t('settings.compatibleMethods')}</p>
                <p className="mb-2 text-xs text-muted-foreground">{t('settings.compatibleMethodsHint')}</p>
                {agency.paymentMethods.filter((method) => method.active).length === 0 ? (
                  <p className="text-sm text-amber-800">{t('settings.addMethodsFirst')}</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {agency.paymentMethods
                      .filter((method) => method.active)
                      .map((method) => {
                        const checked = accountDraft.compatiblePaymentMethodIds.includes(method.id)
                        return (
                          <label key={method.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setAccountDraft((current) => ({
                                  ...current,
                                  compatiblePaymentMethodIds: checked
                                    ? current.compatiblePaymentMethodIds.filter((id) => id !== method.id)
                                    : [...current.compatiblePaymentMethodIds, method.id],
                                }))
                              }
                            />
                            {method.name}
                          </label>
                        )
                      })}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={configMutation.isPending || accountDraft.name.trim().length < 1}
                  onClick={() => upsertNamed('receiving', accountDraft, agency.receivingAccounts)}
                >
                  {accountDraft.id ? t('common.save') : t('common.add')}
                </Button>
                {accountDraft.id ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setAccountDraft({
                        name: '',
                        kind: 'cash',
                        active: true,
                        ownership: '',
                        compatiblePaymentMethodIds: [],
                      })
                    }
                  >
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
                    title={`${item.name} · ${t(`settings.ownership.${item.ownership ?? 'unset'}`)}`}
                    badge={
                      item.active
                        ? (item.compatiblePaymentMethodIds ?? [])
                            .map((id) => agency.paymentMethods.find((method) => method.id === id)?.name ?? id)
                            .join(', ') || t(`settings.accountKinds.${item.kind}`)
                        : t('settings.inactive')
                    }
                    onEdit={() =>
                      setAccountDraft({
                        id: item.id,
                        name: item.name,
                        kind: item.kind,
                        active: item.active,
                        ownership: item.ownership ?? '',
                        compatiblePaymentMethodIds: item.compatiblePaymentMethodIds ?? [],
                      })
                    }
                    onDelete={() => setDestinationActive(item.id, !item.active)}
                    deleteLabel={item.active ? t('settings.deactivate') : t('settings.activate')}
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
                  setLocationDraft((current) => ({
                    ...current,
                    kind: event.target.value as DraftLocation['kind'],
                  }))
                }
              >
                <option value="godown">{t('settings.locationKinds.godown')}</option>
                <option value="vehicle">{t('settings.locationKinds.vehicle')}</option>
                <option value="agent">{t('settings.locationKinds.agent')}</option>
                <option value="csc">{t('settings.locationKinds.csc')}</option>
                <option value="other">{t('settings.locationKinds.other')}</option>
              </select>
              <Button
                disabled={configMutation.isPending || locationDraft.name.trim().length < 2}
                onClick={() => {
                  const name = locationDraft.name.trim()
                  const locations = locationsQuery.data ?? []
                  if (
                    isDuplicateAmong(
                      locations,
                      { id: locationDraft.id },
                      locationUniquenessKey({ name, kind: locationDraft.kind }),
                      locationUniquenessKey,
                    )
                  ) {
                    toast.error(t('settings.duplicateNameCategory'))
                    return
                  }
                  configMutation.mutate({
                    action: 'upsertLocation',
                    payload: {
                      ...(locationDraft.id ? { id: locationDraft.id } : {}),
                      name,
                      kind: locationDraft.kind,
                      active: true,
                    },
                  })
                }}
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
              <div>
                <Input
                  value={productDraft.code}
                  onChange={(event) => setProductDraft((current) => ({ ...current, code: event.target.value }))}
                  placeholder={t('settings.productCode')}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.productCodeHint')}</p>
              </div>
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
                onClick={() => {
                  const name = productDraft.name.trim()
                  const code = productDraft.code.trim()
                  const products = productsQuery.data ?? []
                  if (
                    isDuplicateAmong(
                      products,
                      { id: productDraft.id },
                      productNameUniquenessKey({ name, kind: productDraft.kind }),
                      productNameUniquenessKey,
                    )
                  ) {
                    toast.error(t('settings.duplicateNameCategory'))
                    return
                  }
                  if (
                    isDuplicateAmong(
                      products,
                      { id: productDraft.id },
                      productCodeUniquenessKey(code),
                      (item) => productCodeUniquenessKey(item.code),
                    )
                  ) {
                    toast.error(t('settings.duplicateProductCode'))
                    return
                  }
                  configMutation.mutate({
                    action: 'upsertProduct',
                    payload: {
                      ...(productDraft.id ? { id: productDraft.id } : {}),
                      name,
                      code,
                      kind: productDraft.kind,
                      unit: productDraft.unit.trim() || 'cylinder',
                      active: true,
                    },
                  })
                }}
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
              <div>
                <Input
                  value={priceDraft.label}
                  onChange={(event) => setPriceDraft((current) => ({ ...current, label: event.target.value }))}
                  placeholder={t('settings.priceLabel')}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.priceLabelHint')}</p>
              </div>
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
                    const label = priceDraft.label.trim()
                    if (!priceDraft.productId || label.length < 2) {
                      toast.error(t('errors.invalidInput'))
                      return
                    }
                    const prices = pricesQuery.data ?? []
                    if (
                      isDuplicateAmong(
                        prices,
                        { id: priceDraft.id },
                        priceRuleUniquenessKey({ label, productId: priceDraft.productId }),
                        priceRuleUniquenessKey,
                      )
                    ) {
                      toast.error(t('settings.duplicatePriceLabel'))
                      return
                    }
                    configMutation.mutate({
                      action: 'upsertPriceRule',
                      payload: {
                        ...(priceDraft.id ? { id: priceDraft.id } : {}),
                        productId: priceDraft.productId,
                        label,
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
  deleteLabel,
}: {
  title: string
  badge?: string
  onEdit: () => void
  onDelete: () => void
  deleteLabel?: string
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
        {deleteLabel ?? t('common.delete')}
      </Button>
    </li>
  )
}
