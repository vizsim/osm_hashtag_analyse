# 🛠️ Troubleshooting & Tipps

Sammlung bekannter Probleme und Workarounds rund um den ohsome-planet-Workflow (siehe [readme.md](readme.md)).

---

## `NumberFormatException: Cannot parse null string` bei der Replikation

Beim Replikations-Lauf (Schritt 4 der readme) bricht ohsome-planet ab mit:

```text
java.lang.NumberFormatException: Cannot parse null string
    at java.base/java.lang.Integer.parseInt(...)
    at org.heigit.ohsome.replication.ReplicationState.<init>(ReplicationState.java:41)
    at org.heigit.ohsome.replication.Server.getRemoteState(...)
    at ...ContributionStateManager.lambda$updateToRemoteState$0(...)
```

**Ursache:** Es ist *kein* kaputtes Changeset in den Daten, *kein* ohsome-planet-Versionsproblem und *nicht* das Cookie. ohsome lädt für jeden State zuerst die kleine Metadatei `<seq>.state.txt` (3 Zeilen mit `sequenceNumber=`). Liefert der Geofabrik-Server für eine Sequenz eine **leere Antwort (HTTP 200, 0 Bytes)**, prüft ohsome den Body nicht → `sequenceNumber` fehlt → `Integer.parseInt(null)` stürzt ab.

Das passiert, wenn auf dem `osm-internal`-Server **ein einzelner Tages-Diff defekt** ist. Beispiel (29.06.2026): Sequenz **4809** (9. Juni) war komplett kaputt – sowohl `4809.state.txt` als auch `4809.osc.gz` waren **0 Bytes**, während 4808 und 4810 normal waren. Der öffentliche Server (`download.geofabrik.de`) hatte 4809 intakt – es ist also ein serverseitiger Fehler im internen Feed.

> ⚠️ Die hartkodierte 8-fach-Parallelität beim Laden (`flatMapSequential(…, 8)` in `ContributionStateManager`) bestimmt nur, **wann** die kaputte Datei erwischt wird (im ersten Lauf sah es deshalb so aus, als bräche es „mittendrin" ab). Ein `--size 1`-Einzellauf kommt zwar bis zur kaputten Sequenz, **bleibt dann aber genauso hängen** – die leere Datei lässt sich nicht „durch weniger Parallelität" reparieren.

### Schritt 1 – ausschließen, dass es am Cookie liegt

Diese Debug-Zeile zeigt, ob Auth mitgeschickt wird (`with cookie gf_download_oauth=…` = ok, `with cookie null` = Env-Var kommt nicht im Prozess an):

```bash
java -jar ohsome-planet-cli/target/ohsome-planet.jar replications \
  --data ~/ohsome-planet/data/germany_from2025_rep \
  --changeset-db "jdbc:postgresql://localhost:5433/postgres" \
  -vv 2>&1 | grep -m1 "germany-updates.*with cookie"
```

### Schritt 2 – die defekte Sequenz finden

Im Log steht `Updating towards remote state <remote> from <local>` – die kaputte Sequenz liegt knapp über `<local>`. Per curl prüfen (0 Bytes = kaputt):

```bash
CK="$(~/sendfile_osm_oauth_protector/oauth_cookie_client.py -s ~/.geofabrik.json -o -)"
BASE="https://osm-internal.download.geofabrik.de/europe/germany-updates"
for n in $(seq <local+1> <remote>); do
  p=$(printf '000/004/%03d' $n)
  sz=$(curl -sS -H "Cookie: $CK" -o /dev/null -w '%{size_download}' "$BASE/$p.state.txt")
  [ "$sz" -lt 50 ] && echo "KAPUTT: $n ($sz B)"
done
```

### Schritt 3 – die kaputte Sequenz überspringen

Wenn `<seq>.state.txt` **und** `<seq>.osc.gz` leer sind, gibt es im internen Feed schlicht nichts zu holen → Sequenz überspringen, indem man den lokalen State-Zeiger vorrückt. ohsome liest den maßgeblichen Stand aus **`<data>/replication/state.txt`** (die Datei mit `endpoint=`). Diese auf die kaputte Sequenz setzen, dann nimmt der nächste Lauf bei `<seq>+1` wieder auf.

> ⚠️ **Nicht verbatim einfügen** – zuerst `SEQ` und `TS` unten setzen. Der Zahlencheck verhindert, dass ein leerer Platzhalter in die State-Datei geschrieben wird (sonst kommt beim nächsten Lauf `NumberFormatException: For input string: "<seq>"`).

```bash
D=~/ohsome-planet/data/germany_from2025_rep

# --- die kaputte Sequenz + ihren Timestamp eintragen: ---
SEQ=4809                  # die defekte Sequenznummer
TS=2026-06-09T20:21:43Z   # Timestamp dieser Sequenz (s. curl unten)

# Timestamp nachschlagen, falls unbekannt (oeffentlicher Server ist intakt):
#   curl -sS "https://download.geofabrik.de/europe/germany-updates/$(printf '000/004/%03d' "$SEQ").state.txt"

# Sicherheitscheck – SEQ muss eine Zahl sein:
[[ "$SEQ" =~ ^[0-9]+$ ]] || { echo "ABBRUCH: SEQ ist keine Zahl"; }

if [[ "$SEQ" =~ ^[0-9]+$ ]]; then
  cp "$D/replication/state.txt" "$D/replication/state.txt.bak"   # Backup
  cat > "$D/replication/state.txt" <<EOF
#${SEQ} manuell uebersprungen (geofabrik-internal leer)
endpoint=https://osm-internal.download.geofabrik.de/europe/germany-updates/
sequenceNumber=${SEQ}
timestamp=${TS}
EOF
  cat "$D/replication/state.txt"
fi
```

> 🚨 **Vorsicht – Skip ist nur frei, wenn der Tag WIRKLICH leer war.** Prüfe vorher die Größe des Diffs auf dem **öffentlichen** Server:
>
> ```bash
> curl -sS -o /dev/null -w '%{size_download} Bytes\n' \
>   "https://download.geofabrik.de/europe/germany-updates/000/004/<seq>.osc.gz"
> ```
>
> - **Auch dort ~0 Bytes** → der Tag war echt leer, Skip ist folgenlos.
> - **Mehrere MB** (Normalfall!) → Geofabrik hat einen **vollen Tag verschluckt**. Dann fehlen ohsome alle an dem Tag bearbeiteten Objekt-Versionen, und ein späterer Diff stürzt mit **`No before found for id …`** ab (siehe unten). Der Skip ist dann **nicht** verlustfrei.
>
> Lässt sich das Datenverzeichnis noch auf einen Stand **vor** der kaputten Sequenz bringen (Backup!), ist der saubere Weg: Endpoint für genau diese eine Sequenz auf den öffentlichen Server zeigen (`https://download.geofabrik.de/...`), den State per `--size 1` einmal ziehen, dann zurück auf internal. Ohne Backup bleibt nur das Tolerieren der Lücke (siehe „Folgefehler"). Den defekten Diff zusätzlich bei [Geofabrik](https://www.geofabrik.de/) melden.

### Schritt 4 – weiterlaufen lassen

Danach die Replikation normal weiterlaufen lassen. Sind viele States offen, hilft eine Schleife mit `--size 1` (ein State pro Lauf, wirkt zugleich als Retry bei sporadischen Aussetzern):

```bash
for i in $(seq 1 40); do
  java -jar ohsome-planet-cli/target/ohsome-planet.jar replications \
    --data ~/ohsome-planet/data/germany_from2025_rep \
    --changeset-db "jdbc:postgresql://localhost:5433/postgres" \
    --size 1 -v
done
```

Erfolgskontrolle: `cat ~/ohsome-planet/data/germany_from2025_rep/updates/state.txt` zeigt am Ende die aktuelle `sequenceNumber`.

**Dauerhafter Code-Fix (optional):** In `Server.getRemoteState(URL)` leere/ungültige Antworten abfangen – bei sporadisch leeren 200ern kurz warten und neu laden (Retry), bei dauerhaft leeren Sequenzen die Sequenz mit 0 Contributions als erledigt markieren statt zu crashen. Danach einmal `mvn package` bauen.

---

## Folgefehler nach einem Skip (verschluckter Tag)

Wenn man eine Sequenz übersprungen hat, die in Wahrheit echte Edits enthielt (siehe Warnung oben), tauchen später diese Fehler auf:

### `RuntimeException: No before found for id …`

Ein späterer Diff fasst ein Objekt an (oder einen Node eines Ways → „minor way"), dessen Vorversion am übersprungenen Tag lag. ohsome kennt diese „before"-Version nicht und bricht in [`ContributionUpdater.filter`](../ohsome-planet/ohsome-replication-update/src/main/java/org/heigit/ohsome/replication/update/ContributionUpdater.java) ab.

Sauber wäre, den fehlenden Tag nachzuziehen (Backup nötig, s.o.). Ohne Backup: die Lücke tolerieren – `ContributionUpdater.filter()` so patchen, dass es das Objekt überspringt statt zu werfen:

```java
if (osh.isEmpty() && before == null) {
    logger.warn("No before found for id {} - skipping", id);
    return;   // statt: throw new RuntimeException(...)
}
```

Danach `mvn -q -DskipTests package` neu bauen. Folge: Contributions des verschluckten Tages fehlen, einzelne betroffene Objekte sind unvollständig. **Hashtags/Changesets sind nicht betroffen** – die kommen aus der separaten Changeset-DB (planet.osm.org), nicht von Geofabrik.

### `FileAlreadyExistsException: …/replication/tmp/<seq>.opc.parquet`

Ein vorheriger Lauf ist mitten in der Verarbeitung gecrasht und hat eine halbe Temp-Datei hinterlassen; jeder neue Lauf scheitert dann sofort daran. Einfach aufräumen:

```bash
rm -f ~/ohsome-planet/data/germany_from2025_rep/replication/tmp/*.opc.parquet
```

### `RocksDBException: … LOCK: Resource temporarily unavailable`

Es läuft (oder hängt suspendiert) noch ein anderer ohsome-planet-Prozess – der UpdateStore erlaubt nur **einen** gleichzeitig. Häufige Ursache: einen hängenden Lauf mit **Ctrl-Z** statt Ctrl-C „beendet" – `^Z` pausiert nur und hält den Lock. Aufräumen:

```bash
pkill -9 -f ohsome-planet.jar
jobs -l; ps aux | grep '[o]hsome-planet.jar'   # beides muss leer sein
```

> 💡 Hängende Läufe immer mit **Ctrl-C** abbrechen, nie mit Ctrl-Z.
