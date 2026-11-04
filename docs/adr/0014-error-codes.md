# ADR 0014 — Errores con código: la API dice qué pasó y cada cliente lo redacta

- **Estado:** aceptada · 2026-11-04

## Contexto

La interfaz está en español y la API responde en inglés. Los errores llegaban a la pantalla tal cual: quien pedía más vacaciones de las que tenía leía `Insufficient vacation balance: 12 day(s) available on 2026-12-07, the request uses 15`. Las personas que usan el sistema no tienen por qué saber inglés, y a menudo el error es justo lo que necesitan entender.

El alcance era mayor de lo que parecía: 81 sitios lanzan errores en 21 archivos, además de los del validador (`employeeCode must be 2-20 letters, digits or -`), la base de datos, el límite de peticiones y los fallos que ni pasan por la API (`Failed to fetch` sin red, una página HTML de `nginx` durante un reinicio). Más de 40 lugares de la web los mostraban, y solo 3 formularios traducían algo, cada uno a su manera.

## Alternativas

1. **Traducir los textos en la API.** Es el cambio más corto, pero ata la API a un idioma y a una interfaz, contra lo decidido en el [ADR 0007](0007-notifications.md) («datos, no frases»), y rompe a quien ya lea esos mensajes.
2. **Que la web compare las frases en inglés.** No toca la API, pero cualquier retoque de un texto rompe la traducción sin que nada avise, y los mensajes con valores obligan a analizar texto.
3. **Un código estable con sus datos, y que cada cliente redacte.** Es más trabajo inicial: hay que clasificar cada error. Es la misma idea de las notificaciones (ADR 0007) y de los errores de dispositivos (`CODE: detalle`).

## Decisión

Se adopta la opción 3.

- **El catálogo es un tipo.** `ApiErrorParams` en `packages/shared` asocia cada `code` con la forma de sus `params`. No hay un código sin definir ni datos con otra forma, porque no compila.
- **Se añade, no se reemplaza.** La respuesta suma `code` y `params`. `message` sigue igual y en inglés, para logs y para quien llama a la API a mano, pero ningún cliente debe compararlo.
- **Todo error tiene código.** Lo que no trae uno propio (una ruta inexistente, el limitador) recibe uno genérico según su estado HTTP.
- **La validación dice qué regla de qué campo falló.** `CodedValidationPipe` añade `violations` (`{ field, rule }`). Extiende el `ValidationPipe` de NestJS en vez de reemplazar su fábrica de errores, para conservar sus mensajes y el límite que pone a su tamaño, y limita además el número de violaciones.
- **No se puede olvidar.** Una regla de ESLint rechaza en `apps/api/src` cualquier excepción HTTP sin `apiError(...)`.
- **La web traduce en un solo lugar**, de modo que los lugares que muestran un error no tengan que saberlo. El tipo exige un texto por cada código.

Los reportes CSV y los correos sí salen en español desde la API: no son respuestas que un cliente redacte, sino documentos terminados.

## Consecuencias

- Un error nuevo cuesta una línea más en el catálogo y un texto en la web. A cambio, ninguno puede llegar en inglés a una persona sin que falle el lint o la compilación.
- Otro cliente, u otro idioma, solo necesita su propio mapa de códigos.
- Los códigos son contrato: se pueden añadir, pero no cambiar de significado.
- Una web más antigua que la API (durante una actualización) puede recibir un código que no conoce: cae en el texto genérico de ese estado HTTP.
