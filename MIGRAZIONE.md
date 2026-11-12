# Piano di migrazione a Tasca sincronizzata

## Obiettivo

Usare Tasca su iPhone e Mac con le stesse spese, mantenendo al sicuro i dati oggi salvati solo nel browser.

## 1. Backup prima di ogni passaggio

1. Apri la versione di Tasca che contiene i dati attuali, nello stesso browser in cui sono stati inseriti.
2. Premi **Scarica backup**.
3. Conserva il file `tasca-backup-AAAAMMGG.json` in File, iCloud Drive o in un'altra posizione sicura.
4. Non cancellare i dati del browser finché non avremo verificato l'importazione nel cloud.

Il file contiene le spese, i budget, la versione del formato e la data di esportazione. Non contiene password né chiavi di accesso.

## 2. Preparazione del cloud

- Creare un progetto Supabase.
- Attivare l'accesso personale via email e password oppure magic link.
- Creare tabelle per spese e budget, entrambe associate all'utente autenticato.
- Applicare regole di sicurezza che permettono a ogni utente di leggere e modificare solo i propri dati.

Lo schema e le regole sono già pronti in `supabase/schema.sql`. Il file non contiene segreti e dovrà essere eseguito una sola volta nel SQL Editor del progetto Supabase.

## 3. Importazione controllata

- Usare il comando **Scegli un backup** in Tasca.
- Prima dell'importazione, validare struttura, importi, date, categorie e identificativi.
- Mostrare un riepilogo e chiedere conferma prima di caricare i dati.
- Usare gli identificativi già presenti per evitare duplicati se il file viene importato due volte.
- Confermare a schermo il numero di spese e budget trasferiti.

## 4. Verifica e passaggio alla sincronizzazione

1. Confrontare quantità e totali con il backup originale.
2. Provare una nuova spesa su iPhone e verificarla sul Mac.
3. Solo dopo questa verifica, rendere Supabase la sorgente principale dei dati.
4. Mantenere l'esportazione manuale come ulteriore protezione.

## 5. PWA e pubblicazione

Dopo la sincronizzazione aggiungeremo manifest, icone e supporto offline, quindi pubblicheremo l'app con HTTPS. L'installazione su iPhone avverrà da Safari tramite “Aggiungi a Home”.
