# Credits

## Model

[MegaLoc](https://github.com/gmberton/MegaLoc) is by Gabriele Berton and Carlo Masone, MIT licence. The QVAC SDK downloads the weights on first use.

## Font

The interface uses Geist, by The Geist Project Authors, under the SIL Open Font License 1.1 (`public/assets/Geist-OFL.txt`).

## Street photos (downloaded, not in this repository)

`npm run fetch` downloads the 10,000 indexed street photos from [Mapillary](https://www.mapillary.com). They are by Mapillary contributors and licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The app shows the contributor's name under the matched photo. `mapillary-ids.json` holds only the Mapillary image ids we picked, not the photos.

## Map

`map/map.json` holds streets, water, parks and labels for the two areas, extracted from [OpenStreetMap](https://www.openstreetmap.org/copyright) through the Overpass API and simplified. Map data © OpenStreetMap contributors, available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). As a derived database, `map/map.json` is also available under the ODbL.

## Example and challenge photos (in this repository)

All from [Wikimedia Commons](https://commons.wikimedia.org). Each file here is a resized copy (960 px wide) of the original, which is linked below with its author and licence. The licences of these photos apply to them, not the Apache 2.0 licence of the code.

### Examples (`examples/`)

| File | Original | Author | Licence |
|---|---|---|---|
| `example-1.jpg` | [Rue Faubourg Temple - Paris XI (FR75) - 2024-11-24 - 2.jpg](https://commons.wikimedia.org/wiki/File:Rue_Faubourg_Temple_-_Paris_XI_(FR75)_-_2024-11-24_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `example-2.jpg` | [Place du Docteur-Alfred-Fournier et rue Bichat (Paris) 01.jpg](https://commons.wikimedia.org/wiki/File:Place_du_Docteur-Alfred-Fournier_et_rue_Bichat_(Paris)_01.jpg) | Coyau | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `example-3.jpg` | [Place Pan Yuliang - Paris III (FR75) - 2025-07-24 - 3.jpg](https://commons.wikimedia.org/wiki/File:Place_Pan_Yuliang_-_Paris_III_(FR75)_-_2025-07-24_-_3.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `example-4.jpg` | [Immeuble 117 Boulevard Saint-Germain (2).JPG](https://commons.wikimedia.org/wiki/File:Immeuble_117_Boulevard_Saint-Germain_(2).JPG) | Fabio Gargano | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `example-5.jpg` | [Rue Jean Marie Moinon - Paris X (FR75) - 2021-06-23 - 1.jpg](https://commons.wikimedia.org/wiki/File:Rue_Jean_Marie_Moinon_-_Paris_X_(FR75)_-_2021-06-23_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `example-6.jpg` | [Paris, Pont Neuf -- 2014 -- 1430.jpg](https://commons.wikimedia.org/wiki/File:Paris,_Pont_Neuf_--_2014_--_1430.jpg) | Dietmar Rabich | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `example-7.jpg` | [Place Raoul Follereau - Paris X (FR75) - 2021-06-23 - 1.jpg](https://commons.wikimedia.org/wiki/File:Place_Raoul_Follereau_-_Paris_X_(FR75)_-_2021-06-23_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

### Challenges for the game (`challenges/`)

| File | Original | Author | Licence |
|---|---|---|---|
| `challenge-01.jpg` | [Paris boulevard st denis.jpg](https://commons.wikimedia.org/wiki/File:Paris_boulevard_st_denis.jpg) | Ralf.treinen | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `challenge-02.jpg` | [Rue Tournon - Paris VI (FR75) - 2022-08-04 - 1.jpg](https://commons.wikimedia.org/wiki/File:Rue_Tournon_-_Paris_VI_(FR75)_-_2022-08-04_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-03.jpg` | [Rue Tournon - Paris VI (FR75) - 2021-07-29 - 1.jpg](https://commons.wikimedia.org/wiki/File:Rue_Tournon_-_Paris_VI_(FR75)_-_2021-07-29_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-04.jpg` | [Rue Soufflot (Paris), 2006 (01).jpg](https://commons.wikimedia.org/wiki/File:Rue_Soufflot_(Paris),_2006_(01).jpg) | Bahnfrend | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-05.jpg` | [Passage Brady (32228035806).jpg](https://commons.wikimedia.org/wiki/File:Passage_Brady_(32228035806).jpg) | koronis.at | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
| `challenge-06.jpg` | [Boulevard Saint Germain - Paris VII (FR75) - 2021-05-11 - 2.jpg](https://commons.wikimedia.org/wiki/File:Boulevard_Saint_Germain_-_Paris_VII_(FR75)_-_2021-05-11_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-07.jpg` | [Gare Est - Paris X (FR75) - 2025-04-05 - 3.jpg](https://commons.wikimedia.org/wiki/File:Gare_Est_-_Paris_X_(FR75)_-_2025-04-05_-_3.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-08.jpg` | [Place Québec - Paris VI (FR75) - 2021-05-11 - 3.jpg](https://commons.wikimedia.org/wiki/File:Place_Qu%C3%A9bec_-_Paris_VI_(FR75)_-_2021-05-11_-_3.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-09.jpg` | [Rue Tournon - Paris VI (FR75) - 2024-11-08 - 1.jpg](https://commons.wikimedia.org/wiki/File:Rue_Tournon_-_Paris_VI_(FR75)_-_2024-11-08_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-10.jpg` | [Rue 8 Mai 1945 - Paris X (FR75) - 2021-06-02 - 1.jpg](https://commons.wikimedia.org/wiki/File:Rue_8_Mai_1945_-_Paris_X_(FR75)_-_2021-06-02_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-11.jpg` | [Paris-Plage 2011 Pont-Neuf.jpg](https://commons.wikimedia.org/wiki/File:Paris-Plage_2011_Pont-Neuf.jpg) | Tangopaso | Public domain |
| `challenge-12.jpg` | [Rue Rennes - Paris VI (FR75) - 2023-06-04 - 2.jpg](https://commons.wikimedia.org/wiki/File:Rue_Rennes_-_Paris_VI_(FR75)_-_2023-06-04_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-13.jpg` | [Place Québec - Paris VI (FR75) - 2021-05-11 - 1.jpg](https://commons.wikimedia.org/wiki/File:Place_Qu%C3%A9bec_-_Paris_VI_(FR75)_-_2021-05-11_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-14.jpg` | [Place Mehdi Ben Barka - Paris VI (FR75) - 2021-07-29 - 3.jpg](https://commons.wikimedia.org/wiki/File:Place_Mehdi_Ben_Barka_-_Paris_VI_(FR75)_-_2021-07-29_-_3.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-15.jpg` | [Rue Tournon - Paris VI (FR75) - 2021-07-29 - 2.jpg](https://commons.wikimedia.org/wiki/File:Rue_Tournon_-_Paris_VI_(FR75)_-_2021-07-29_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-16.jpg` | [Rue Faubourg Saint Martin - Paris X (FR75) - 2024-06-03 - 2.jpg](https://commons.wikimedia.org/wiki/File:Rue_Faubourg_Saint_Martin_-_Paris_X_(FR75)_-_2024-06-03_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-17.jpg` | [Arrêt Bus Lancry Saint Martin Boulevard Saint Martin - Paris X (FR75) - 2024-11-17 - 1.jpg](https://commons.wikimedia.org/wiki/File:Arr%C3%AAt_Bus_Lancry_Saint_Martin_Boulevard_Saint_Martin_-_Paris_X_(FR75)_-_2024-11-17_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-18.jpg` | [Passage Industrie - Paris X (FR75) - 2021-06-23 - 1.jpg](https://commons.wikimedia.org/wiki/File:Passage_Industrie_-_Paris_X_(FR75)_-_2021-06-23_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-19.jpg` | [Place Mehdi Ben Barka - Paris VI (FR75) - 2021-07-29 - 1.jpg](https://commons.wikimedia.org/wiki/File:Place_Mehdi_Ben_Barka_-_Paris_VI_(FR75)_-_2021-07-29_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-20.jpg` | [Accès Station Métro Arts Métiers Rue Réaumur - Paris III (FR75) - 2021-12-20 - 3.jpg](https://commons.wikimedia.org/wiki/File:Acc%C3%A8s_Station_M%C3%A9tro_Arts_M%C3%A9tiers_Rue_R%C3%A9aumur_-_Paris_III_(FR75)_-_2021-12-20_-_3.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-21.jpg` | [Peugeot 3008, police nationale - Manifestation mars 2023 (Paris).jpg](https://commons.wikimedia.org/wiki/File:Peugeot_3008,_police_nationale_-_Manifestation_mars_2023_(Paris).jpg) | Kevin.B | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-22.jpg` | [Paris 75006 Quai de Conti Bouquinistes 20150902.jpg](https://commons.wikimedia.org/wiki/File:Paris_75006_Quai_de_Conti_Bouquinistes_20150902.jpg) | Ninara from Helsinki, Finland | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `challenge-23.jpg` | [Boulevard Strasbourg - Paris X (FR75) - 2025-09-19 - 2.jpg](https://commons.wikimedia.org/wiki/File:Boulevard_Strasbourg_-_Paris_X_(FR75)_-_2025-09-19_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-24.jpg` | [Rue Taylor - Paris X (FR75) - 2021-06-25 - 1.jpg](https://commons.wikimedia.org/wiki/File:Rue_Taylor_-_Paris_X_(FR75)_-_2021-06-25_-_1.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-25.jpg` | [Passerelle Bichat, January 19, 2013.jpg](https://commons.wikimedia.org/wiki/File:Passerelle_Bichat,_January_19,_2013.jpg) | Jean-François Gornet | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
| `challenge-26.jpg` | [Rue Beaurepaire (Paris).jpg](https://commons.wikimedia.org/wiki/File:Rue_Beaurepaire_(Paris).jpg) | Benoît Prieur | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `challenge-27.jpg` | [Accès Station Métro Arts Métiers Rue Réaumur - Paris III (FR75) - 2021-12-20 - 2.jpg](https://commons.wikimedia.org/wiki/File:Acc%C3%A8s_Station_M%C3%A9tro_Arts_M%C3%A9tiers_Rue_R%C3%A9aumur_-_Paris_III_(FR75)_-_2021-12-20_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-28.jpg` | [Rue Cherche Midi - Paris VI (FR75) - 2022-06-16 - 2.jpg](https://commons.wikimedia.org/wiki/File:Rue_Cherche_Midi_-_Paris_VI_(FR75)_-_2022-06-16_-_2.jpg) | Chabe01 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `challenge-29.jpg` | [Chez Prune 1, Paris 29 May 2014.jpg](https://commons.wikimedia.org/wiki/File:Chez_Prune_1,_Paris_29_May_2014.jpg) | David McSpadden from Daly City, United States | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `challenge-30.jpg` | [Metro Rue du Bac, Paris 24 August 2013.jpg](https://commons.wikimedia.org/wiki/File:Metro_Rue_du_Bac,_Paris_24_August_2013.jpg) | flightlog | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
