# ADR 0012 — Vacaciones por año calendario

- **Estado:** aceptada · 2026-09-29
- **Amplía:** [ADR 0008](0008-vacation-balances.md)

## Contexto

El ADR 0008 devenga por **año de servicio**: el año completo en cada aniversario (`ANNUAL`) o un doceavo por mes cumplido (`MONTHLY`). Muchas empresas, en cambio, organizan las vacaciones por **año calendario**: cada persona tiene N días "del año 2027", los puede usar durante ese año y quien entra o sale a mitad de año recibe la parte proporcional. El ADR 0008 lo dejó fuera de alcance.

## Decisión

Un tercer modo de devengo en `ContractType.vacationAccrual`: **`CALENDAR_YEAR`**.

- **Abono por adelantado el 1 de enero** con los días del año. A diferencia de `ANNUAL`, que abona al terminar el año de servicio, aquí los días se pueden usar desde el primer día del año, que es el sentido de este esquema.
- **Año de ingreso prorrateado** por los días del año trabajados desde la fecha de ingreso (ambos incluidos, 365 o 366), abonado ese mismo día.
- **Año de baja prorrateado** hasta la fecha de baja. Como el saldo se calcula y no se guarda, el abono del año se recorta solo al registrar la baja; si la persona ya había usado más, el saldo queda negativo, que es lo que se descuenta en la liquidación. Un saldo consultado **a una fecha anterior** a la baja muestra el año completo, como estaba entonces.
- **Antigüedad**: cada año calendario vale lo del año de servicio en curso el día del abono (1 de enero o fecha de ingreso). El bono sigue siendo el del contrato ([ADR 0008](0008-vacation-balances.md)).
- **Caducidad** ([ADR 0009](0009-vacation-expiry.md)): los meses se cuentan desde el **31 de diciembre** del año en que se ganaron los días. "3 meses" equivale al esquema habitual de "hasta el 31 de marzo del año siguiente".
- Los prorrateos se guardan sin redondear y el saldo se muestra con dos decimales, igual que los doceavos de `MONTHLY`.

Todo vive en el dominio puro (`calendarYearCredits` en `vacations/domain/vacation-entitlement.ts`), al lado de los otros dos modos, que no cambian.

## Consecuencias

- Una empresa con vacaciones por año calendario lo configura en el tipo de contrato, sin tocar código.
- Quien ingresa a mitad de año puede pedir vacaciones enseguida, con su parte proporcional.
- **Fuera de alcance por ahora:** redondear el prorrateo a medios días o días enteros (algunas políticas lo hacen) y años fiscales que no empiezan el 1 de enero.
