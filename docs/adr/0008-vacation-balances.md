# ADR 0008 — Saldos de vacaciones: reglas por tipo de contrato, saldo calculado

- **Estado:** aceptada · 2026-09-23

## Contexto

Las vacaciones ya se solicitaban y aprobaban ([ADR 0006](0006-unified-leave-requests.md)), pero nada decía **cuántos días le quedan a cada persona**. Una empresa real necesita que:

- el derecho dependa del contrato (tiempo completo, medio tiempo…) y, a menudo, de la antigüedad;
- no se aprueben vacaciones que el saldo no cubre, salvo que la empresa permita anticipos;
- se pueda cargar el saldo que traía cada persona de otro sistema y corregir errores.

Y sigue vigente la regla del proyecto: **ningún valor de ninguna legislación en el código**.

## Decisión

- **`ContractType`** agrupa las reglas: días por año, devengo (`ANNUAL`: en cada aniversario; `MONTHLY`: 1/12 por mes completo), cómo se cuentan los días (`WORKING_DAYS` o `CALENDAR_DAYS`), un bono de antigüedad opcional (días extra por año a partir de N años, con tope) y si se permiten anticipos. Son **datos**: los valores del seed son ejemplos.
- **El saldo no se guarda: se calcula** en cada lectura a partir de las entradas (reglas del contrato, fecha de ingreso y de baja, solicitudes aprobadas y pendientes, ajustes):

  ```
  disponible = devengado + ajustes − usados − programados − pendientes
  ```

  Editar un tipo de contrato o cancelar una solicitud se refleja al instante, y el saldo no puede desincronizarse de sus causas. La función de devengo es **pura** (sin Nest, Prisma ni reloj), como el motor de asistencia.

- **Días hábiles según el horario de cada persona**, con el calendario de asistencia (turnos, descansos y feriados). Quien no tiene horario asignado descuenta todos los días que no son feriado: la opción conservadora, porque ninguna vacación sale gratis por falta de configuración.
- **Se valida al solicitar y otra vez al aprobar**, con el saldo **a la fecha de inicio** de la vacación: se pueden reservar días que se devengarán antes de salir. Las pendientes reservan sus días; aprobar puede fallar si el saldo cambió entretanto (otro permiso aprobado, un ajuste).
- **Ajustes manuales** (`VacationAdjustment`, positivos o negativos, siempre con motivo) para saldos iniciales y correcciones. Los registra RRHH y quedan en la auditoría.
- Sin tipo de contrato no hay derecho calculado ni validación: el saldo es solo la suma de ajustes. Permite adoptar la función de forma gradual.

## Consecuencias

- Una empresa configura sus reglas sin tocar código; cambiar de política es editar un tipo de contrato.
- Cada lectura del saldo recalcula a partir de pocas filas por empleado, y el calendario solo se carga para las fechas con solicitudes. Si hiciera falta un reporte masivo, se calcularía en lote con el mismo dominio puro.
- **Fuera de alcance por ahora:** caducidad o tope de acumulación de días no usados (_carry-over_; resuelto en el [ADR 0009](0009-vacation-expiry.md)), fraccionamiento en medios días ([ADR 0010](0010-half-day-vacations.md)) y periodos de devengo por año calendario en lugar de aniversario. Encajan como nuevos campos de `ContractType` y nuevas reglas en la función pura, sin cambiar el modelo.
