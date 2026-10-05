-- CN-20261001-035: el índice único (accountId, sequence) ya cubre las mismas
-- columnas; el índice no único era redundante y encarecía cada inserción.
DROP INDEX "CurrencyMovement_accountId_sequence_idx";
