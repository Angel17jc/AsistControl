# ADR 0015 — Turnos sin hora fija y empresas que no pagan horas extra

- **Estado:** aceptada · 2026-11-04

## Contexto

La primera empresa que usará el sistema no tiene horario fijo: un lunes entran a las 08:00, un martes a las 09:00, y salen a las 18:00, 19:00 o 20:00, con una hora de almuerzo. Tampoco paga horas extra. Lo que Recursos Humanos necesita es ver y descargar las entradas, los almuerzos, las salidas y las horas de cada día.

El motor medía todo contra un turno fijo. Al ejecutarlo con sus días, un día normal de 09:00 a 18:00 salía como «1 h de atraso y 1 h extra», y se proponían horas extra para aprobar que nadie iba a pagar.

## Alternativas

1. **Solo con configuración:** un turno de 08:00 a 17:00 con mucha tolerancia y horas extra «por exceso». No requiere código, pero el atraso seguiría existiendo a partir de cierta hora, las jornadas mostrarían un horario que no es real, un día corto no se avisaría y las marcaciones a las 21:00 o más seguirían expuestas a la ventana del turno.
2. **No asignar horario.** Las horas salen bien, pero sin horario el sistema no distingue un día laborable de un descanso: no hay ausencias ni días cortos, y cada jornada figura como «Sin horario».
3. **Un tipo de turno sin hora fija, y las horas extra como decisión de la empresa.** Requiere una migración y tocar el motor, pero reutiliza horarios semanales, feriados, permisos y ausencias.

## Decisión

Se adopta la opción 3.

- **`WorkShift.flexible`.** Es una propiedad del turno, no de la empresa: una misma empresa puede tener personal de oficina sin horario y guardias con turno fijo.
- **Sus horas son una referencia.** Entrada, salida y almuerzo solo dicen cuántas horas se esperan al día (08:00 a 17:00 con una hora de almuerzo son 8 h), de modo que no hace falta un campo más. El almuerzo de referencia es también el que se descuenta si nadie lo marcó.
- **Su ventana es el día calendario.** Una entrada a las 06:00 o una salida a las 22:30 son de ese día. Por eso no puede cruzar medianoche (`FLEXIBLE_SHIFT_OVERNIGHT`).
- **No hay atraso, salida anticipada ni marcación fuera de horario.** La jornada no guarda horario programado, para no mostrar uno que no existe.
- **Se avisa si faltan horas.** Un día cerrado con menos de lo esperado lleva `shortMinutes` y la novedad `SHORT_HOURS`, sin cambiar su estado: la persona vino. Solo se evalúa con el día cerrado y completo, porque antes puede seguir trabajando. Un permiso aprobado reduce lo esperado, y `earlyLeaveToleranceMinutes` hace de margen.
- **`attendance.policy.overtimeEnabled`.** Las horas extra sí son decisión de toda la empresa. Apagadas, no se calculan ni se proponen, y las propuestas pendientes desaparecen al recalcular; las ya revisadas se conservan, como cualquier decisión de una persona. Encendidas, en un turno sin hora fija cuentan lo que pase de las horas esperadas, porque no hay hora de salida con la que medirlas.
- **`GET /settings/features`** dice esto a cualquier sesión: un empleado no puede leer la configuración, y sus pantallas también dependen de ella. Las columnas de la tabla de jornadas se deciden por los datos, de modo que siguen mostrando lo que ya esté guardado.

## Consecuencias

- Las reglas de un turno fijo no cambian, ni tampoco los datos existentes: `flexible` empieza en falso y `overtimeEnabled` en verdadero.
- Quien sale después de medianoche en un turno sin hora fija cuenta esa marcación en el día siguiente. Si alguna empresa lo necesita, tendrá que usar un turno de noche.
- En Presencia, una salida lejos del almuerzo de referencia se lee como «se fue» hasta que marque el regreso: sin horario no hay otra forma de saberlo.
- Cambiar un turno o la regla de horas extra afecta a los días que se calculen desde entonces. Los pasados necesitan un recálculo.
