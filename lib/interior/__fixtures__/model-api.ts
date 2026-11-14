/** Authored wire-shape test data, NOT a recorded Model API response. */
export const syntheticModelApiResponse = {
  data: {
    model: {
      id: "Synthetic01",
      floors: [
        { id: "floor-one", dimensionEstimates: { area: 100, units: "metric" } },
      ],
      rooms: [
        {
          id: "room-one",
          floor: { id: "floor-one" },
          dimensionEstimates: {
            area: 100,
            height: 3,
            lowerElevation: 2,
            units: "metric",
          },
          boundary: {
            edges: [
              {
                vertices: [
                  { position: { x: -5, y: -4 } },
                  { position: { x: 5, y: -4 } },
                ],
              },
              {
                vertices: [
                  { position: { x: 5, y: -4 } },
                  { position: { x: 5, y: 6 } },
                ],
              },
              {
                vertices: [
                  { position: { x: 5, y: 6 } },
                  { position: { x: -5, y: 6 } },
                ],
              },
              {
                vertices: [
                  { position: { x: -5, y: 6 } },
                  { position: { x: -5, y: -4 } },
                ],
              },
            ],
          },
        },
      ],
    },
  },
};
