"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  ErrorState,
  LoadingBlock,
  Notice,
  StatusBadge,
  useToast,
  useUnsavedChanges,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { setWorkerServices, setWorkerSkills } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import type { ForceInput } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { Worker } from "@/lib/admin/types";
import { StaleDialog } from "../../catalog/_components/CatalogFields";
import { ShortfallDialog, useShortfallGuard } from "../../_ops/Shortfall";
import { useHasFullCatalog, useServiceChoices, useSkills, type ServiceChoice } from "../../_ops/options";
import { useOpsText } from "../../_ops/opsText";
import { useWorkerCache } from "./workerShared";

const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Services & skills tab: what the worker is eligible for and her skills (workers.manage edits, everyone else reads). */
export function WorkerServicesTab({ worker }: { worker: Worker }) {
  const { can } = useAdminSession();
  const manage = can("workers.manage");
  return (
    <>
      <ServicesCard worker={worker} manage={manage} />
      <SkillsCard worker={worker} manage={manage} />
    </>
  );
}

function ServicesCard({ worker, manage }: { worker: Worker; manage: boolean }) {
  const t = useTranslations("admin.workers.services");
  const text = useOpsText();
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const cache = useWorkerCache();
  const choices = useServiceChoices();
  const fullCatalog = useHasFullCatalog();
  const guard = useShortfallGuard<number[]>();
  const current = (worker.services ?? []).map((s) => s.id);
  const [initial, setInitial] = useState<number[]>(current);
  const [selected, setSelected] = useState<number[]>(current);
  const [stale, setStale] = useState(false);
  const dirty = !sameIds(selected, initial);
  useUnsavedChanges(manage && dirty);

  // Services the worker has that the choices do not list (e.g. a service now inactive) stay visible.
  const options: ServiceChoice[] = [...(choices.data ?? [])];
  for (const s of worker.services ?? []) if (!options.some((o) => o.id === s.id)) options.push({ ...s, is_active: false });

  const save = useMutation({
    mutationFn: ({ ids, force }: { ids: number[]; force?: ForceInput }) => setWorkerServices(worker.id, ids, cache.version(worker), force),
    onSuccess: (saved) => {
      cache.saved(saved);
      const ids = (saved.services ?? []).map((s) => s.id);
      setInitial(ids);
      setSelected(ids);
      guard.clear();
      toast.success(t("saved", { name: saved.display_name }));
    },
    onError: (error, vars) => {
      if (guard.capture(error, vars.ids)) return;
      if (vars.force) return;
      guard.clear();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
    },
  });
  const pending = guard.state;

  if (!manage) {
    return (
      <Card title={t("title")}>
        {(worker.services ?? []).length === 0 ? (
          <p className="text-sm text-ink-600">{t("none")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {(worker.services ?? []).map((s) => (
              <li key={s.id} className="rounded-pill bg-petrol-50 px-2.5 py-0.5 text-[13px] font-medium text-petrol-700">
                {text.name(s.name)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <Card title={t("title")}>
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      {!fullCatalog && <Notice tone="neutral">{t("partialList")}</Notice>}
      {choices.isPending ? (
        <LoadingBlock lines={3} />
      ) : choices.isError ? (
        <ErrorState error={choices.error} onRetry={() => void choices.refetch()} />
      ) : options.length === 0 ? (
        <p className="text-sm text-ink-600">{t("noOptions")}</p>
      ) : (
        <CheckboxGroup legend={t("legend")}>
          {options.map((s) => {
            const needsLiveOut = s.kind === "live_out" && !worker.can_live_out;
            return (
              <Checkbox
                key={s.id}
                label={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {text.name(s.name)}
                    {!s.is_active && <StatusBadge tone="neutral">{t("inactive")}</StatusBadge>}
                  </span>
                }
                description={needsLiveOut ? t("needsLiveOut") : text.serviceKind(s.kind)}
                checked={selected.includes(s.id)}
                onChange={(e) => setSelected((list) => (e.target.checked ? [...list, s.id] : list.filter((id) => id !== s.id)))}
              />
            );
          })}
        </CheckboxGroup>
      )}
      {save.error && !pending && !(save.error instanceof AdminApiError && ["STALE_VERSION", "CAPACITY_SHORTFALL"].includes(save.error.code)) ? (
        <Notice tone="danger">{describe(save.error)}</Notice>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setSelected(initial)}>
          {t("discard")}
        </Button>
        <Button onClick={() => save.mutate({ ids: selected })} disabled={!dirty} loading={save.isPending && !pending}>
          {t("save")}
        </Button>
      </div>
      {pending && (
        <ShortfallDialog
          shortfalls={pending.shortfalls}
          pending={save.isPending}
          forceError={save.error && !(save.error instanceof AdminApiError && save.error.code === "CAPACITY_SHORTFALL") ? save.error : null}
          onClose={guard.clear}
          onForce={(force) => save.mutate({ ids: pending.vars, force })}
        />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void cache.reload(worker.id).then((fresh) => {
            const ids = (fresh.services ?? []).map((s) => s.id);
            setInitial(ids);
            setSelected(ids);
          });
        }}
      />
    </Card>
  );
}

function SkillsCard({ worker, manage }: { worker: Worker; manage: boolean }) {
  const t = useTranslations("admin.workers.skills");
  const text = useOpsText();
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const cache = useWorkerCache();
  const skills = useSkills(manage);
  const current = (worker.skills ?? []).map((s) => s.id);
  const [initial, setInitial] = useState<number[]>(current);
  const [selected, setSelected] = useState<number[]>(current);
  const [stale, setStale] = useState(false);
  const dirty = !sameIds(selected, initial);
  useUnsavedChanges(manage && dirty);

  // Active skills, plus any inactive skill the worker still has.
  const options = (skills.data ?? []).filter((s) => s.is_active || current.includes(s.id));

  const save = useMutation({
    mutationFn: (ids: number[]) => setWorkerSkills(worker.id, ids, cache.version(worker)),
    onSuccess: (saved) => {
      cache.saved(saved);
      const ids = (saved.skills ?? []).map((s) => s.id);
      setInitial(ids);
      setSelected(ids);
      toast.success(t("saved", { name: saved.display_name }));
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
    },
  });

  if (!manage) {
    return (
      <Card title={t("title")}>
        {(worker.skills ?? []).length === 0 ? (
          <p className="text-sm text-ink-600">{t("none")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {(worker.skills ?? []).map((s) => (
              <li key={s.id} className="rounded-pill bg-petrol-50 px-2.5 py-0.5 text-[13px] font-medium text-petrol-700">
                {text.name(s.name)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <Card title={t("title")}>
      {skills.isPending ? (
        <LoadingBlock lines={3} />
      ) : skills.isError ? (
        <ErrorState error={skills.error} onRetry={() => void skills.refetch()} />
      ) : options.length === 0 ? (
        <p className="text-sm text-ink-600">{t("noOptions")}</p>
      ) : (
        <CheckboxGroup legend={t("legend")}>
          {options.map((s) => (
            <Checkbox
              key={s.id}
              label={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {text.name(s.name)}
                  {!s.is_active && <StatusBadge tone="neutral">{t("inactive")}</StatusBadge>}
                </span>
              }
              checked={selected.includes(s.id)}
              onChange={(e) => setSelected((list) => (e.target.checked ? [...list, s.id] : list.filter((id) => id !== s.id)))}
            />
          ))}
        </CheckboxGroup>
      )}
      {save.error && !(save.error instanceof AdminApiError && save.error.code === "STALE_VERSION") ? (
        <Notice tone="danger">{describe(save.error)}</Notice>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setSelected(initial)}>
          {t("discard")}
        </Button>
        <Button onClick={() => save.mutate(selected)} disabled={!dirty} loading={save.isPending}>
          {t("save")}
        </Button>
      </div>
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void cache.reload(worker.id).then((fresh) => {
            const ids = (fresh.skills ?? []).map((s) => s.id);
            setInitial(ids);
            setSelected(ids);
          });
        }}
      />
    </Card>
  );
}
