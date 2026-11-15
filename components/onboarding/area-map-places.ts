import type { City } from "./flow";

// Geographic place anchors extracted from OpenFreeMap/OpenStreetMap `place` tiles
// at z14 (planet snapshot 20261101_080013_pt), November 15, 2026.
// Curated here because neighborhood features are omitted from low-zoom tiles.
export const areaMapPlaces: Record<
  City,
  { name: string; coordinates: [number, number] }[]
> = {
  Houston: [
    {
      name: "The Heights",
      coordinates: [-95.398445, 29.797686],
    },
    {
      name: "Uptown",
      coordinates: [-95.461364, 29.745562],
    },
    {
      name: "River Oaks",
      coordinates: [-95.426511, 29.747942],
    },
    {
      name: "Montrose",
      coordinates: [-95.391278, 29.744696],
    },
    {
      name: "Midtown",
      coordinates: [-95.376171, 29.74124],
    },
    {
      name: "Downtown",
      coordinates: [-95.365244, 29.756558],
    },
    {
      name: "Museum District",
      coordinates: [-95.387839, 29.724699],
    },
    {
      name: "Third Ward",
      coordinates: [-95.359054, 29.724382],
    },
    {
      name: "Eastwood",
      coordinates: [-95.332918, 29.735464],
    },
  ],
  "Los Angeles": [
    {
      name: "Hollywood",
      coordinates: [-118.329524, 34.098004],
    },
    {
      name: "Westwood",
      coordinates: [-118.439945, 34.066894],
    },
    {
      name: "Culver City",
      coordinates: [-118.396466, 34.021124],
    },
    {
      name: "Venice",
      coordinates: [-118.466885, 33.995043],
    },
    {
      name: "West Adams",
      coordinates: [-118.352484, 34.029433],
    },
    {
      name: "Silver Lake",
      coordinates: [-118.269373, 34.089652],
    },
    {
      name: "Echo Park",
      coordinates: [-118.256782, 34.077981],
    },
    {
      name: "Downtown",
      coordinates: [-118.252099, 34.047997],
    },
    {
      name: "Hancock Park",
      coordinates: [-118.335055, 34.07368],
    },
  ],
};
