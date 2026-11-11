-- CN-20261007-045 (MEDIO-2 de CN-20261007-044): el bono de bienvenida por sí solo no
-- debe retener el borrado de una cuenta. El libro sigue siendo inmutable; la única
-- excepción es un DELETE de un movimiento `REWARD` / `WELCOME_BONUS` cuando:
--   1. la transacción declaró explícitamente la cuenta con
--      `set_config('chambeaya.welcome_bonus_delete_account', <accountId>, true)`
--      (local a la transacción: desaparece al confirmar o revertir), y
--   2. la cuenta no tiene NINGÚN movimiento que no sea ese bono.
-- Cualquier UPDATE, cualquier otro DELETE y cualquier DELETE sin el permiso
-- explícito siguen fallando con CURRENCY_MOVEMENT_APPEND_ONLY.
CREATE OR REPLACE FUNCTION "prevent_currency_movement_mutation"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD."action" = 'REWARD'
     AND OLD."actionKey" = 'WELCOME_BONUS'
     AND current_setting('chambeaya.welcome_bonus_delete_account', true) = OLD."accountId"
     AND NOT EXISTS (
       SELECT 1 FROM "CurrencyMovement" m
       WHERE m."accountId" = OLD."accountId"
         AND (m."action" <> 'REWARD' OR m."actionKey" IS DISTINCT FROM 'WELCOME_BONUS')
     )
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'CURRENCY_MOVEMENT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;
