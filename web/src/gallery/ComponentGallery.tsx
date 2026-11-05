import { UsersThreeIcon } from '@phosphor-icons/react'
import { PlusIcon } from '@phosphor-icons/react'
import { Tooltip as RadixTooltip } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/Button'
import { DataTable, LoadMore, type Column } from '@/components/DataTable'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { Avatar, EmptyState, Notice, Skeleton, StatusPill, Tabs, Tooltip } from '@/components/Display'
import { StatCard } from '@/components/StatCard'
import { PasswordField, SelectField, TextArea, TextField } from '@/components/Field'
import { toast } from '@/components/Toast'
import { ExpandableCard, InteractiveCard } from '@/motion/InteractiveCard'
import { MotionArc } from '@/motion/MotionArc'
import { RangeArc } from '@/motion/RangeArc'
import { RangeDial } from '@/motion/RangeDial'
import { RollingNumber } from '@/motion/RollingNumber'
import { LanguageSwitch } from '@/layout/LanguageSwitch'

const COLOURS = ['ink', 'lagoon', 'lagoon-deep', 'sprout', 'sprout-bright', 'amber', 'mist', 'tide', 'night', 'night-panel', 'paper', 'slate', 'line', 'alarm'] as const
const swatch: Record<(typeof COLOURS)[number], string> = {
  ink: 'bg-ink', lagoon: 'bg-lagoon', 'lagoon-deep': 'bg-lagoon-deep', sprout: 'bg-sprout', 'sprout-bright': 'bg-sprout-bright', amber: 'bg-amber', mist: 'bg-mist', tide: 'bg-tide',
  night: 'bg-night', 'night-panel': 'bg-night-panel', paper: 'bg-paper', slate: 'bg-slate', line: 'bg-line', alarm: 'bg-alarm',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-10">
      <h2 className="mb-5 text-2xl font-bold">{title}</h2>
      {children}
    </section>
  )
}

type Row = { id: string; name: string; plans: number }
const rows: Row[] = [{ id: '1', name: 'Ana Dela Cruz', plans: 2 }, { id: '2', name: 'Ramon Bautista', plans: 1 }, { id: '3', name: 'Liza Mercado', plans: 1 }]
const columns: ReadonlyArray<Column<Row>> = [
  { key: 'name', header: 'Name', sortable: true, cell: (row) => <span className="font-semibold">{row.name}</span> },
  { key: 'plans', header: 'Plans', align: 'end', cell: (row) => <span className="numeric">{row.plans}</span> },
]

/** Every component in every state. This page is the surface for design review. */
export function ComponentGallery() {
  const [tab, setTab] = useState('one')
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [range, setRange] = useState<[number, number]>([20, 120])
  const [selection, setSelection] = useState('a')
  const [count, setCount] = useState(120)
  return (
    <RadixTooltip.Provider>
      <main className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="text-5xl font-bold">Design system</h1>
        <p className="mt-2 max-w-[62ch] text-lg text-slate">The motion arc brand on large screens. Headings and key numbers use Bricolage Grotesque; everything else uses Atkinson Hyperlegible Next, chosen so similar characters stay distinct.</p>

        <Section title="Colour">
          <div className="grid grid-cols-2 gap-4 tablet:grid-cols-4 desk:grid-cols-7">
            {COLOURS.map((name) => <div key={name}><div className={`h-16 rounded-control border border-line ${swatch[name]}`} /><p className="mt-1 text-sm">{name}</p></div>)}
          </div>
        </Section>

        <Section title="Type">
          <p className="numeric text-6xl font-bold">112°</p>
          <h3 className="text-4xl font-bold">Page title</h3>
          <h3 className="text-2xl font-bold">Section heading</h3>
          <p className="mt-2 max-w-[62ch]">Body text stays under 80 characters a line. Il1 O0 rn m: similar letters and numbers stay easy to tell apart, which matters when a value is clinical.</p>
          <p className="text-sm text-slate">Secondary text</p>
        </Section>

        <Section title="Buttons">
          {(['primary', 'secondary', 'quiet', 'danger', 'bright'] as const).map((variant) => (
            <div key={variant} className="mb-3 flex flex-wrap items-center gap-3">
              <Button variant={variant} leading={<PlusIcon weight="bold" aria-hidden />}>Rest and hover</Button>
              <Button variant={variant} busy busyLabel="Working">Busy</Button>
              <Button variant={variant} disabled>Disabled</Button>
              <Button variant={variant} size="sm">Small</Button>
              <Button variant={variant} size="lg">Large</Button>
            </div>
          ))}
        </Section>

        <Section title="Fields">
          <div className="grid gap-5 tablet:grid-cols-2">
            <TextField label="Default" placeholder="Placeholder" />
            <TextField label="With a hint" hint="Help text explains the expected value." defaultValue="Ana" />
            <TextField label="With an error" error="Enter a valid email address." defaultValue="ana@" />
            <TextField label="Disabled" disabled defaultValue="Cannot change" />
            <PasswordField label="Password" defaultValue="fixture-password" />
            <SelectField label="Select" value={selection} onChange={setSelection} options={[{ value: 'a', label: 'First option' }, { value: 'b', label: 'Second option' }]} />
            <TextArea label="Text area" className="tablet:col-span-2" />
          </div>
        </Section>

        <Section title="Status, avatars and tooltips">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill>Neutral</StatusPill><StatusPill tone="primary">Primary</StatusPill><StatusPill tone="positive">Active</StatusPill><StatusPill tone="caution">Partial</StatusPill><StatusPill tone="danger">Disabled</StatusPill>
            <Avatar name="Ana Dela Cruz" /><Avatar name="Ramon" size={56} />
            <Tooltip label="Tooltips add detail, never essential information."><Button variant="secondary" size="sm">Hover or focus</Button></Tooltip>
            <LanguageSwitch />
          </div>
        </Section>

        <Section title="Interactive cards">
          <p className="mb-4 max-w-[62ch] text-slate">Cards are for things a person can act on. Hover or tab to a card: it lifts, a light follows the pointer, and the dial replays the measured movement.</p>
          <div className="grid gap-4 tablet:grid-cols-2 desk:grid-cols-3">
            <InteractiveCard to="/design/therapist/patients/p1" linkLabel="Open Ana Dela Cruz">
              <div className="flex items-center justify-between gap-4 p-5"><div><h3 className="text-lg font-bold">Ana Dela Cruz</h3><p className="text-sm text-slate">Moved 14° to 112°</p></div><RangeDial low={20} high={120} reached={[14, 112]} label="Measured 14 to 112 degrees" /></div>
            </InteractiveCard>
            <InteractiveCard to="/design/therapist/patients/p1" linkLabel="Open Jose Villanueva">
              <div className="flex items-center justify-between gap-4 p-5"><div><h3 className="text-lg font-bold">Jose Villanueva</h3><p className="text-sm text-slate">Moved 18° to 71°</p></div><RangeDial low={20} high={110} reached={[18, 71]} label="Measured 18 to 71 degrees" /></div>
            </InteractiveCard>
            <InteractiveCard dark to="/design/therapist/patients/p1" linkLabel="Open dark card">
              <div className="flex items-center justify-between gap-4 p-5"><div><h3 className="text-lg font-bold">On a dark surface</h3><p className="text-sm text-night-ink">Moved 10° to 84°</p></div><RangeDial dark low={15} high={90} reached={[10, 84]} label="Measured 10 to 84 degrees" /></div>
            </InteractiveCard>
          </div>
          <div className="mt-4 max-w-2xl"><ExpandableCard summary={<h3 className="text-lg font-bold">Expands in place</h3>}><p className="text-slate">The list keeps its position, so a person never loses their place.</p></ExpandableCard></div>
        </Section>

        <Section title="Arcs and numbers">
          <div className="flex flex-wrap items-end gap-10">
            <MotionArc progress={0.72} band={[20, 120]} label="Face at 72 percent"><span className="numeric text-3xl font-bold">72%</span></MotionArc>
            <div className="w-full max-w-md"><RangeArc low={range[0]} high={range[1]} description="Prescribed range" lowLabel="Start angle" highLabel="Target angle" onChange={(low, high) => setRange([low, high])} /></div>
            <div>
              <p className="numeric text-5xl font-bold"><RollingNumber value={count} />°</p>
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setCount((value) => (value === 120 ? 64 : 120))}>Roll the number</Button>
            </div>
          </div>
        </Section>

        <Section title="Stat cards">
          <div className="grid max-w-3xl gap-4 tablet:grid-cols-3"><StatCard icon={UsersThreeIcon} value={18} label="Patients" to="/design/therapist/patients" /><StatCard icon={UsersThreeIcon} value={24} label="Active plans" detail="Across 18 patients" /><StatCard icon={UsersThreeIcon} value={3} label="Without a plan" tone="caution" /></div>
        </Section>

        <Section title="Tabs">
          <Tabs label="Example" value={tab} onChange={setTab} tabs={[{ value: 'one', label: 'All', count: 214 }, { value: 'two', label: 'Patients', count: 186 }, { value: 'three', label: 'Therapists', count: 24 }]} />
        </Section>

        <Section title="Tables">
          <div className="grid gap-10 desk:grid-cols-2">
            <div><DataTable caption="Rows" columns={columns} rows={rows} rowKey={(row) => row.id} sort={{ key: 'name', direction: 'asc' }} onSort={() => undefined} onRowClick={() => undefined} selectedKey="2" /><LoadMore shown="3 of 214" onLoad={() => undefined} label="Load more" /></div>
            <DataTable caption="Loading" columns={columns} rows={[]} rowKey={(row) => row.id} loading />
          </div>
        </Section>

        <Section title="Feedback">
          <div className="flex flex-col gap-3">
            <Notice title="This page could not load" onRetry={() => undefined}>Check your connection and try again.</Notice>
            <Notice tone="caution">Check the timing values against their limits.</Notice>
            <Notice tone="info">Nothing needs attention right now.</Notice>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => toast.show('Prescription published')}>Success toast</Button>
              <Button variant="secondary" onClick={() => toast.show('Could not save the change.', 'error')}>Error toast</Button>
              <Button variant="secondary" onClick={() => toast.show('Publishing', 'pending')}>Pending toast</Button>
              <Button variant="secondary" onClick={() => setDialog(true)}>Dialog</Button>
              <Button variant="secondary" onClick={() => setConfirm(true)}>Confirmation</Button>
            </div>
            <Skeleton className="h-4 w-64" />
            <EmptyState title="No patients yet" detail="An empty page tells a person what to do next." action={<Button>Invite patient</Button>} />
          </div>
        </Section>

        <Dialog open={dialog} onOpenChange={setDialog} title="Invite patient" description="Enter the email the patient signed up with."><TextField label="Email" /></Dialog>
        <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive title="Revoke access to Ana Dela Cruz?" message="You will lose access to Ana Dela Cruz’s records, and your active assignments for this patient will end." confirmLabel="Revoke access" onConfirm={() => toast.show('Access revoked')} />
      </main>
    </RadixTooltip.Provider>
  )
}
