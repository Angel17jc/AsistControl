# ADR 0002 — Patrón Adapter y registro de drivers para dispositivos

- **Estado:** aceptada · 2026-09-21

## Contexto

Las empresas tienen marcadores de distintas marcas (ZKTeco, Hikvision, Anviz…) con protocolos incompatibles, y cambian de proveedor con el tiempo. Acoplar el backend a un SDK impediría soportar varios y haría imposible probar sin hardware.

## Decisión

- Interfaz `BiometricDeviceAdapter` en un paquete propio (`biometric-core`), sin dependencias de Nest ni de base de datos.
- `AdapterRegistry` mapea `driver → factory`. El único lugar que conoce adaptadores concretos es `adapters.provider.ts` (composition root).
- Los adaptadores solo traducen transporte; errores tipados con `retryable` para que la política de reintentos sea común.
- `DeviceConnectionManager` es el único dueño de las instancias (caché por versión del dispositivo, descifrado de credenciales, suscripciones push).
- Primer adaptador: `MockDeviceAdapter` + `MockDeviceSimulator` con inyección de fallos, usado en desarrollo, demo y tests e2e.

## Consecuencias

- Añadir un fabricante no toca el pipeline ni el motor de asistencia.
- El simulador define el comportamiento esperado (timeouts, desconexión, duplicados) que los adaptadores reales deben igualar.
- Cada adaptador real necesita su propia suite con un servidor falso del protocolo.
