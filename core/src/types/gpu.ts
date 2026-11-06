/**
 * The wire shape of a sealed `GpuBuffer` handle (orbital-core `contract/sealed.rs`): what a drawable prop receives
 * when a program hands the canvas GPU data to draw where it lies (EXEC-GPU-7). Only the kernel mints one; a prop
 * typed `GpuBuffer` takes a sealed handle, never a hand-built record.
 */
export interface GpuBuffer {
    readonly id: number;
    readonly device: number;
    readonly size: number;
}
