# ADR 0010 — Medios días de vacaciones

- **Estado:** aceptada · 2026-09-24
- **Amplía:** [ADR 0008](0008-vacation-balances.md)

## Contexto

Una vacación descontaba días enteros: tomarse una mañana costaba lo mismo que el día completo. Muchas empresas permiten fraccionar las vacaciones en medios días y otras no, así que vuelve a ser **configuración del tipo de contrato**.

Las solicitudes ya se guardan como intervalos de tiempo (`startsAt`/`endsAt`), no como fechas, y el motor de asistencia ya entiende permisos parciales (una mañana libre mueve la hora esperada de llegada). Falta que el **saldo** los cobre en proporción.

## Decisión

- **`ContractType.allowHalfDayVacations`** (por defecto no). Sin activarla, todo sigue como antes: cada fecha que toca una vacación cuesta un día entero.
- Con la opción activada, una vacación **dentro de una sola fecha** se cobra por la parte de la jornada que cubre:
  - la jornada es el turno de ese día **menos el almuerzo**, o el día entero si no hay turno (por ejemplo, días corridos en un día libre);
  - **ninguna** parte → 0 días (la solicitud se rechaza: no cubre nada que descontar);
  - **hasta la mitad** → medio día;
  - **más de la mitad** → un día entero.
- **Las vacaciones de varias fechas siguen contando días enteros.** Así, un turno nocturno o una solicitud de lunes a viernes nunca terminan en fracciones inesperadas por cómo caen las horas.
- El cálculo sigue en el dominio puro (`coveredShare`, `partialDayCost`, `vacationDayCost`), con el turno que ya resuelve el calendario de asistencia. El saldo sigue sin guardarse.

## Consecuencias

- Una mañana (08:00-12:00 en un turno de 08:00 a 17:00 con almuerzo de 12:00 a 13:00) cuesta 0,5; de 08:00 a 14:00 cuesta 1.
- Los saldos pueden tener medios días, algo que el modelo ya admitía (decimales y ajustes de 0,5).
- **Fuera de alcance por ahora:** fracciones distintas de la mitad (horas sueltas cobradas en proporción) y medios días en turnos que cruzan la medianoche.
