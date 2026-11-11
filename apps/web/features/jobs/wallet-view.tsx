'use client';

import { Gift, Info, PiggyBank, ReceiptText, WalletCards } from 'lucide-react';

import { formatCoins, formatDateTime, formatSignedCoins } from './format';
import { useJobs } from './jobs-context';
import { jobsApi, type CatalogItem, type RewardItem } from './jobs-api';
import { actionLabel, movementTypeLabel, REWARD_CONDITION } from './labels';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill, ViewHeading } from './ui';
import { usePagedList } from './use-paged';
import { useResource } from './use-resource';

export function WalletView() {
  const { token, currency, balance, balanceError, refreshBalance, onUnauthorized } = useJobs();
  const options = { onUnauthorized, currency };
  const quote = useResource(() => jobsApi.currency.quote(token, 'JOB_PUBLISH_EXTRA'), 'quote', options);
  const catalog = useResource(() => jobsApi.currency.catalog(token), 'catalog', options);
  const rewards = useResource(() => jobsApi.currency.rewards(token), 'rewards', options);
  const movements = usePagedList(
    (cursor, limit) => jobsApi.currency.movements(token, { cursor, limit }),
    'movements',
    { onUnauthorized, currency, pageSize: 20 },
  );

  const costs = (catalog.data?.items ?? []).filter((item) => item.kind === 'COST');
  const publishQuota = costs.find((item) => item.actionKey === 'JOB_PUBLISH_EXTRA');

  return (
    <div className="workspace view-workspace fx-view">
      <ViewHeading eyebrow="Moneda virtual" title="Billetera" description={`Tu saldo de ${currency}, en qué se gasta y cómo ganar más. La moneda solo sirve dentro de Chambeaya: no se retira ni se transfiere.`} />

      <div className="fx-stat-grid">
        <div className="fx-stat">
          <span className="fx-stat-icon"><WalletCards size={20} aria-hidden="true" /></span>
          <div>
            <small>Saldo disponible</small>
            {balance !== null ? <strong data-testid="wallet-balance">{formatCoins(balance, currency)}</strong> : balanceError ? <strong>—</strong> : <strong>Cargando…</strong>}
            {balanceError && <button className="fx-link" type="button" onClick={() => void refreshBalance()}>Reintentar</button>}
          </div>
        </div>
        <div className="fx-stat">
          <span className="fx-stat-icon"><PiggyBank size={20} aria-hidden="true" /></span>
          <div>
            <small>Publicaciones gratuitas este mes</small>
            {publishQuota?.freeMonthlyQuota !== undefined
              ? <strong>{publishQuota.freeRemaining ?? 0} de {publishQuota.freeMonthlyQuota} disponibles</strong>
              : catalog.loading ? <strong>Cargando…</strong> : <strong>—</strong>}
            <small>La cuota se renueva cada mes (hora de Lima).</small>
          </div>
        </div>
        <div className="fx-stat">
          <span className="fx-stat-icon"><Info size={20} aria-hidden="true" /></span>
          <div>
            <small>Tope de gasto diario</small>
            {quote.data
              ? <strong>{formatCoins(quote.data.dailyCap.spentToday, currency)} de {formatCoins(quote.data.dailyCap.limit, currency)}</strong>
              : quote.loading ? <strong>Cargando…</strong> : <strong>—</strong>}
            <small>{quote.data ? `Te quedan ${formatCoins(quote.data.dailyCap.remaining, currency)} por gastar hoy.` : 'Se reinicia cada día a medianoche (Lima).'}</small>
          </div>
        </div>
      </div>
      {quote.error && <p className="fx-callout fx-callout-warn" role="status">No pudimos leer tu tope diario. <button className="fx-link" type="button" onClick={() => void quote.reload()}>Reintentar</button></p>}

      <div className="fx-two-col">
        <section className="panel fx-panel" aria-label="Qué cuesta y qué se gana" aria-busy={catalog.loading}>
          <h2 className="fx-h2"><ReceiptText size={18} aria-hidden="true" /> Costos del catálogo</h2>
          {catalog.loading && <LoadingBlock label="Cargando el catálogo…" />}
          {!catalog.loading && catalog.error && <ErrorBlock error={catalog.error} onRetry={() => void catalog.reload()} title="No pudimos cargar el catálogo" />}
          {!catalog.loading && !catalog.error && costs.length === 0 && <EmptyBlock title="Ninguna acción tiene costo ahora">Todo lo que haces en Chambeaya es gratis por el momento.</EmptyBlock>}
          {costs.length > 0 && (
            <ul className="fx-list fx-list-compact">
              {costs.map((item) => <CostRow key={item.actionKey} item={item} currency={currency} />)}
            </ul>
          )}
          <p className="fx-muted">Lo básico siempre es gratis: registrarte, responder postulantes, cerrar una contratación y ver tu proceso nunca piden {currency}. Los valores pueden cambiar.</p>
        </section>

        <section className="panel fx-panel" aria-label="Premios" aria-busy={rewards.loading}>
          <h2 className="fx-h2"><Gift size={18} aria-hidden="true" /> Premios para tu empresa</h2>
          {rewards.loading && <LoadingBlock label="Cargando premios…" />}
          {!rewards.loading && rewards.error && <ErrorBlock error={rewards.error} onRetry={() => void rewards.reload()} title="No pudimos cargar los premios" />}
          {!rewards.loading && !rewards.error && (rewards.data?.items.length ?? 0) === 0 && <EmptyBlock title="Por ahora no hay premios activos" />}
          {rewards.data && rewards.data.items.length > 0 && (
            <>
              <ul className="fx-list fx-list-compact">
                {rewards.data.items.map((item) => <RewardRow key={item.actionKey} item={item} currency={currency} />)}
              </ul>
              <p className="fx-muted">
                Hay un tope para evitar abusos: hoy ganaste {formatCoins(rewards.data.caps.daily.earned, currency)} de {formatCoins(rewards.data.caps.daily.limit, currency)} y este mes {formatCoins(rewards.data.caps.monthly.earned, currency)} de {formatCoins(rewards.data.caps.monthly.limit, currency)}.
                El bono de bienvenida no cuenta para el tope.
              </p>
            </>
          )}
        </section>
      </div>

      <section className="panel fx-panel" aria-label="Movimientos" aria-busy={movements.loading}>
        <h2 className="fx-h2">Movimientos</h2>
        {movements.loading && <LoadingBlock label="Cargando movimientos…" />}
        {!movements.loading && movements.error && <ErrorBlock error={movements.error} onRetry={() => void movements.reload()} title="No pudimos cargar tus movimientos" />}
        {!movements.loading && !movements.error && movements.items.length === 0 && (
          <EmptyBlock icon={<ReceiptText size={26} aria-hidden="true" />} title="Todavía no tienes movimientos">
            Aquí verás tus gastos, devoluciones y premios con el saldo que quedó después de cada uno.
          </EmptyBlock>
        )}
        {movements.items.length > 0 && (
          <div className="fx-table-wrap">
            <table className="fx-table">
              <caption className="fx-sr-only">Movimientos de la billetera, del más reciente al más antiguo</caption>
              <thead>
                <tr><th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Acción</th><th scope="col" className="fx-num">Movimiento</th><th scope="col" className="fx-num">Saldo resultante</th></tr>
              </thead>
              <tbody>
                {movements.items.map((movement) => (
                  <tr key={movement.id}>
                    <td data-label="Fecha">{formatDateTime(movement.createdAt)}</td>
                    <td data-label="Tipo">{movementTypeLabel(movement.action)}</td>
                    <td data-label="Acción">
                      {movement.action === 'ADMIN_ADJUSTMENT' ? (movement.reason ?? 'Ajuste') : actionLabel(movement.actionKey)}
                      {movement.action === 'ACTION_REFUND' && <small className="fx-muted"> · devolución de un cobro</small>}
                    </td>
                    <td data-label="Movimiento" className={`fx-num ${movement.quantity > 0 ? 'fx-plus' : 'fx-minus'}`}>{formatSignedCoins(movement.quantity)}</td>
                    <td data-label="Saldo resultante" className="fx-num">{formatCoins(movement.balanceAfter, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {movements.refreshFailed && <p className="fx-callout fx-callout-warn" role="status">No pudimos actualizar los movimientos.</p>}
        {movements.hasMore && !movements.loading && (
          <div className="fx-more">
            <button className="secondary-button" type="button" disabled={movements.loadingMore} onClick={() => void movements.loadMore()}>{movements.loadingMore ? 'Cargando…' : 'Ver más movimientos'}</button>
            {movements.loadMoreError && <small className="fx-field-error" role="alert">{movements.loadMoreError.message}</small>}
          </div>
        )}
      </section>
    </div>
  );
}

function CostRow({ item, currency }: { item: CatalogItem; currency: string }) {
  return (
    <li className="fx-row fx-row-slim">
      <div className="fx-row-main">
        <h3>{actionLabel(item.actionKey)}</h3>
        <p className="fx-meta">
          <span><strong>{formatCoins(item.amount, currency)}</strong></span>
          {item.freeMonthlyQuota ? <span>{item.freeRemaining ?? 0} de {item.freeMonthlyQuota} gratis este mes</span> : <span>Sin cuota gratuita</span>}
          {item.refundWindowHours ? <span>Devolución si no responden en {item.refundWindowHours} h</span> : null}
        </p>
      </div>
    </li>
  );
}

function RewardRow({ item, currency }: { item: RewardItem; currency: string }) {
  const earned = item.status === 'EARNED';
  const condition = REWARD_CONDITION[item.actionKey];
  return (
    <li className="fx-row fx-row-slim">
      <div className="fx-row-main">
        <div className="fx-row-title">
          <h3>{actionLabel(item.actionKey)}</h3>
          <StatusPill status={earned ? 'ACCEPTED' : 'APPLIED'} label={earned ? 'Ganado' : 'Disponible'} />
        </div>
        <p className="fx-meta">
          <span><strong>+{formatCoins(item.amount, currency)}</strong>{item.repeatable ? ' cada vez' : ' una sola vez'}</span>
          {item.earnedCount > 0 && <span>Ganaste {formatCoins(item.earnedAmount, currency)} ({item.earnedCount} {item.earnedCount === 1 ? 'vez' : 'veces'})</span>}
          {item.actionKey === 'COMPANY_VERIFIED' && !earned && <span>{item.verified ? 'Tu empresa está verificada' : 'Tu empresa aún no está verificada'}</span>}
          {item.monthly && <span>Este mes: {item.monthly.used} de {item.monthly.limit}</span>}
        </p>
        {condition && <p className="fx-muted">{condition}</p>}
      </div>
    </li>
  );
}
