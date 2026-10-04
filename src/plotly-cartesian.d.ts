declare module "plotly.js-cartesian-dist-min" {
  const Plotly: {
    newPlot: (root: HTMLElement, data: object[], layout: object, config: object) => Promise<unknown>;
    purge: (root: HTMLElement) => void;
    Plots: { resize: (root: HTMLElement) => void };
  };
  export default Plotly;
}
