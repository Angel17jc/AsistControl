# ADR 0009 — Caducidad de días de vacaciones no usados

- **Estado:** aceptada · 2026-09-24
- **Amplía:** [ADR 0008](0008-vacation-balances.md)

## Contexto

Con el ADR 0008 los días no usados se acumulaban sin límite. Muchas empresas, por política propia o por la legislación que aplican, no lo permiten: los días de un periodo deben usarse dentro de cierto plazo o se pierden. El plazo cambia de una empresa a otra (a fin del año siguiente, a los dos o a los tres años…), así que sigue siendo **configuración, no código**.

## Decisión

- **`ContractType.vacationExpiryMonths`** (vacío = no caducan): los días ganados en un año de servicio caducan esos meses después de **su aniversario**. Con devengo mensual, las doce fracciones de un año caducan juntas, como un único periodo.
- **Se gastan primero los días que vencen antes.** Recorriendo la línea de tiempo, cada día de vacaciones consume el lote que vence antes, así nadie pierde un día que podía haber usado. Un anticipo (saldo negativo) queda como deuda y lo cubre el siguiente abono antes que nada.
- **El saldo sigue calculándose, no se guarda.** La caducidad es otra función pura (`vacations/domain/vacation-expiry.ts`) sobre las mismas entradas:

  ```
  disponible = devengado + ajustes − usados − programados − pendientes − caducados
  ```

  Añadir, cambiar o quitar el plazo se refleja al instante, también hacia atrás: quitarlo devuelve los días caducados.

- **Los ajustes manuales no caducan.** Suelen ser saldos traídos de otro sistema o correcciones; si deben caducar, RR. HH. registra un ajuste negativo. Se gastan después de los días que sí vencen.
- **Tras la baja no caduca nada**: el saldo de quien se fue se liquida, no se pierde.
- El saldo expone `expiredDays` y **`nextExpiry`** (fecha y días que vencerán), teniendo en cuenta las vacaciones ya aprobadas antes de esa fecha, para avisar a tiempo a la persona y a RR. HH.
- La validación al solicitar y al aprobar no cambia: usa el saldo **a la fecha de inicio**, que ya descuenta lo caducado para entonces.

## Consecuencias

- Una política de caducidad es un número en el tipo de contrato; sin él, el saldo es exactamente el del ADR 0008.
- Un tope de acumulación ("nunca más de N días") no se implementa aparte: un plazo de caducidad ya limita el saldo a unos pocos periodos, que es lo que buscan esas políticas.
- **Avisos (añadido después):** una tarea diaria avisa con `VACATION_EXPIRING` a cada persona con cuenta cuyo `nextExpiry` cae dentro de 30 días, una sola vez por fecha de vencimiento. Solo a ella: los días son suyos, y RR. HH. los ve en su panel.
- **Fuera de alcance por ahora:** días de un periodo que vencen en fechas distintas según cuándo se ganaron (cada fracción mensual con su propio plazo).
