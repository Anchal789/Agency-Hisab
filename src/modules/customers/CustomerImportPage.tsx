import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import {
  applyColumnMappingChange,
  classifyImportRows,
  hasRequiredImportMapping,
  mapSheetRows,
  suggestColumnMapping,
  type ClassifiedImportRow,
  type CustomerColumnMapping,
  type CustomerImportField,
  type ImportRowIssue,
  type ParsedImportRow,
} from '@shared/customers/excel'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { checkCustomerConsumerNumbers, commitCustomerImport } from '@/services/api/customers'
import { callableErrorMessage } from '@/services/errors'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const COMMIT_CHUNK = 400
const FIELD_ORDER: CustomerImportField[] = [
  'fullName',
  'firstName',
  'lastName',
  'address',
  'city',
  'consumerNumber',
  'lastRefillDate',
]

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'summary'

type ImportSummary = {
  totalRows: number
  validCount: number
  invalidCount: number
  createdCount: number
  skippedCount: number
  failedCount: number
  issues: ImportRowIssue[]
  skipped: Array<{ rowNumber: number; consumerNumber: string; reason: string }>
  failed: Array<{ batchId: string; reason: string }>
}

function newBatchId(sessionId: string, chunkIndex: number): string {
  return `${sessionId}-c${chunkIndex}`
}

export function CustomerImportPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [fileInputKey, setFileInputKey] = useState(0)
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([])
  const [mapping, setMapping] = useState<CustomerColumnMapping>({})
  const [classified, setClassified] = useState<ClassifiedImportRow[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const importLockRef = useRef(false)

  const fieldLabel = (field: CustomerImportField): string => {
    switch (field) {
      case 'fullName':
        return t('customers.fullName')
      case 'firstName':
        return t('customers.firstName')
      case 'lastName':
        return t('customers.lastName')
      case 'address':
        return t('customers.address')
      case 'city':
        return t('customers.city')
      case 'consumerNumber':
        return t('customers.consumerNumber')
      case 'lastRefillDate':
        return t('customers.lastRefillDate')
    }
  }

  const nameMode = mapping.fullName ? 'full' : 'split'

  const previewStats = useMemo(() => {
    const valid = classified.filter((row) => row.status === 'valid')
    const invalid = classified.filter((row) => row.status === 'invalid')
    const issues = invalid.flatMap((row) => (row.status === 'invalid' ? row.issues : []))
    return { valid, invalid, issues, total: classified.length }
  }, [classified])

  function resetFile() {
    setStep('upload')
    setFileName('')
    setHeaders([])
    setRawRows([])
    setMapping({})
    setClassified([])
    setSummary(null)
    setProgress({ done: 0, total: 0 })
    setSessionId(crypto.randomUUID())
    setFileInputKey((value) => value + 1)
  }

  async function onFileSelected(file: File | null) {
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      toast.error(t('customers.importErrors.fileType'))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t('customers.importErrors.fileSize'))
      return
    }

    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) {
        toast.error(t('customers.importErrors.emptyFile'))
        return
      }
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: true,
      })
      if (rows.length === 0) {
        toast.error(t('customers.importErrors.emptyFile'))
        return
      }
      const nextHeaders = Object.keys(rows[0] ?? {})
      if (nextHeaders.length === 0) {
        toast.error(t('customers.importErrors.missingColumns'))
        return
      }
      setFileName(file.name)
      setHeaders(nextHeaders)
      setRawRows(rows)
      setMapping(suggestColumnMapping(nextHeaders))
      setSessionId(crypto.randomUUID())
      setStep('map')
    } catch {
      toast.error(t('customers.importErrors.malformed'))
    } finally {
      setBusy(false)
    }
  }

  async function runValidation(nextMapping: CustomerColumnMapping = mapping) {
    if (!hasRequiredImportMapping(nextMapping)) {
      toast.error(t('customers.importErrors.mapRequired'))
      return
    }
    setBusy(true)
    try {
      const parsed = mapSheetRows(rawRows, nextMapping)
      const consumerNumbers = parsed.map((row) => row.consumerNumber).filter(Boolean)
      const existing = await checkCustomerConsumerNumbers(consumerNumbers)
      const existingSet = new Set(existing.map((value) => value.trim().toLowerCase()))
      const nextClassified = classifyImportRows(parsed, existingSet)
      setClassified(nextClassified)
      setStep('preview')
    } catch (error) {
      toast.error(callableErrorMessage(error, t))
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (importLockRef.current) return
    const validRows = previewStats.valid.map((row) => row.row).filter((row): row is ParsedImportRow => Boolean(row))
    if (validRows.length === 0) {
      toast.error(t('customers.importErrors.nothingToImport'))
      return
    }

    importLockRef.current = true
    setBusy(true)
    setStep('importing')
    setProgress({ done: 0, total: validRows.length })

    let createdCount = 0
    let skippedCount = 0
    const skipped: Array<{ rowNumber: number; consumerNumber: string; reason: string }> = []
    const failed: Array<{ batchId: string; reason: string }> = []

    try {
      for (let index = 0; index < validRows.length; index += COMMIT_CHUNK) {
        const chunk = validRows.slice(index, index + COMMIT_CHUNK)
        const chunkIndex = Math.floor(index / COMMIT_CHUNK)
        const batchId = newBatchId(sessionId, chunkIndex)
        try {
          const result = await commitCustomerImport({
            batchId,
            fileName,
            records: chunk.map((row) => ({
              rowNumber: row.rowNumber,
              firstName: row.firstName,
              lastName: row.lastName,
              address: row.address,
              city: row.city,
              consumerNumber: row.consumerNumber,
              lastRefillDate: row.lastRefillDate,
            })),
          })
          createdCount += result.createdCount
          skippedCount += result.skippedCount
          skipped.push(...result.skipped)
        } catch (error) {
          failed.push({ batchId, reason: callableErrorMessage(error, t) })
        }
        setProgress({ done: Math.min(index + chunk.length, validRows.length), total: validRows.length })
      }

      const nextSummary: ImportSummary = {
        totalRows: classified.length,
        validCount: validRows.length,
        invalidCount: previewStats.invalid.length,
        createdCount,
        skippedCount: skippedCount + previewStats.invalid.length,
        failedCount: failed.length,
        issues: previewStats.issues,
        skipped,
        failed,
      }
      setSummary(nextSummary)
      setStep('summary')
      if (failed.length === 0 && createdCount > 0) {
        toast.success(t('customers.importDone', { count: createdCount }))
      } else if (failed.length > 0) {
        toast.error(t('customers.importPartialFailure'))
      } else {
        toast.message(t('customers.importNoneCreated'))
      }
    } finally {
      importLockRef.current = false
      setBusy(false)
    }
  }

  function downloadErrorReport() {
    if (!summary) return
    const lines = [
      'rowNumber,code,consumerNumber,message',
      ...summary.issues.map(
        (issue) =>
          `${issue.rowNumber},${issue.code},${JSON.stringify(issue.consumerNumber ?? '')},${JSON.stringify(issue.message)}`,
      ),
      ...summary.skipped.map(
        (item) => `${item.rowNumber},skipped_on_commit,${JSON.stringify(item.consumerNumber)},${JSON.stringify(item.reason)}`,
      ),
      ...summary.failed.map((item) => `0,batch_failed,${JSON.stringify(item.batchId)},${JSON.stringify(item.reason)}`),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `customer-import-errors-${fileName || 'report'}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('customers.importTitle')}
        description={t('customers.importBody')}
        actions={
          <Button asChild variant="outline">
            <Link to="/customers">{t('customers.backToList')}</Link>
          </Button>
        }
      />

      {step === 'upload' ? (
        <div className="max-w-2xl space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">{t('customers.importUploadHint')}</p>
          <Input
            key={fileInputKey}
            type="file"
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(event) => void onFileSelected(event.target.files?.[0] ?? null)}
          />
        </div>
      ) : null}

      {step === 'map' ? (
        <div className="max-w-3xl space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {t('customers.selectedFile')}: <span className="font-medium">{fileName}</span>
            </p>
            <Button type="button" variant="outline" onClick={resetFile}>
              {t('customers.replaceFile')}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t('customers.importMapHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELD_ORDER.map((field) => {
              const disabled = nameMode === 'full' && (field === 'firstName' || field === 'lastName')
              return (
                <FormField
                  key={field}
                  label={fieldLabel(field)}
                  htmlFor={`map-${field}`}
                  hint={field === 'fullName' ? t('customers.fullNameHint') : undefined}
                >
                  <select
                    id={`map-${field}`}
                    className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60"
                    value={mapping[field] ?? ''}
                    disabled={disabled}
                    onChange={(event) =>
                      setMapping((prev) => applyColumnMappingChange(prev, field, event.target.value || undefined))
                    }
                  >
                    <option value="">{t('customers.importUnmapped')}</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </FormField>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void runValidation()}>
              {busy ? t('common.loading') : t('customers.importPreview')}
            </Button>
            <Button type="button" variant="outline" onClick={resetFile}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'preview' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <StatCard label={t('customers.importStats.total')} value={previewStats.total} />
            <StatCard label={t('customers.importStats.valid')} value={previewStats.valid.length} />
            <StatCard label={t('customers.importStats.invalid')} value={previewStats.invalid.length} />
            <StatCard
              label={t('customers.importStats.duplicates')}
              value={previewStats.issues.filter((issue) => issue.code === 'duplicate_in_file' || issue.code === 'exists_in_db').length}
            />
          </div>

          {previewStats.valid.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t('customers.importCols.row')}</th>
                    <th className="px-3 py-2">{t('customers.name')}</th>
                    <th className="px-3 py-2">{t('customers.consumerNumber')}</th>
                    <th className="px-3 py-2">{t('customers.city')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewStats.valid.slice(0, 50).map((entry) =>
                    entry.status === 'valid' ? (
                      <tr key={`valid-${entry.row.rowNumber}`} className="border-t border-border">
                        <td className="px-3 py-2">{entry.row.rowNumber}</td>
                        <td className="px-3 py-2 font-medium">{entry.row.displayName}</td>
                        <td className="px-3 py-2 font-mono text-xs">{entry.row.consumerNumber}</td>
                        <td className="px-3 py-2">{entry.row.city || '—'}</td>
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
              {previewStats.valid.length > 50 ? (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  {t('customers.importPreviewTruncated', { count: previewStats.valid.length })}
                </p>
              ) : null}
            </div>
          ) : null}

          {previewStats.invalid.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t('customers.importCols.row')}</th>
                    <th className="px-3 py-2">{t('customers.consumerNumber')}</th>
                    <th className="px-3 py-2">{t('customers.importCols.reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewStats.issues.slice(0, 100).map((issue, index) => (
                    <tr key={`${issue.rowNumber}-${issue.code}-${index}`} className="border-t border-border">
                      <td className="px-3 py-2">{issue.rowNumber}</td>
                      <td className="px-3 py-2 font-mono text-xs">{issue.consumerNumber || '—'}</td>
                      <td className="px-3 py-2">{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : previewStats.valid.length > 0 ? (
            <EmptyState title={t('customers.importReadyTitle')} description={t('customers.importReadyBody')} />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || previewStats.valid.length === 0} onClick={() => void runImport()}>
              {t('customers.importCommit', { count: previewStats.valid.length })}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep('map')}>
              {t('customers.importBackMap')}
            </Button>
            <Button type="button" variant="outline" onClick={resetFile}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'importing' ? (
        <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-medium">{t('customers.importProgress')}</p>
          <p className="text-sm text-muted-foreground">
            {progress.done} / {progress.total}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {step === 'summary' && summary ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('customers.importStats.processed')} value={summary.totalRows} />
            <StatCard label={t('customers.importStats.imported')} value={summary.createdCount} />
            <StatCard label={t('customers.importStats.skipped')} value={summary.skippedCount} />
            <StatCard label={t('customers.importStats.failed')} value={summary.failedCount} />
          </div>
          {(summary.issues.length > 0 || summary.skipped.length > 0 || summary.failed.length > 0) && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={downloadErrorReport}>
                {t('customers.importDownloadErrors')}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => navigate('/customers')}>
              {t('customers.backToList')}
            </Button>
            <Button type="button" variant="outline" onClick={resetFile}>
              {t('customers.importAnother')}
            </Button>
          </div>
        </div>
      ) : null}
    </PageContainer>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
