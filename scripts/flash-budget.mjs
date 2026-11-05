import { readFileSync } from 'node:fs';

const image = readFileSync(process.argv[2]);
const partition = 0xf80000;
const erase = 0x10000;
if (image.readUInt32BE(0) !== 0x5ea3a417) throw new Error('Expected DIR-869 SEAMA image');
let offset = -1;
let rootfsBytes = 0;
for (let pos = 0x80000; pos + 96 <= image.length; pos += erase) {
    if (image.toString('ascii', pos, pos + 4) !== 'hsqs' || image.readUInt16LE(pos + 28) !== 4) continue;
    const used = Number(image.readBigUInt64LE(pos + 40));
    if (used < 96 || used > image.length - pos) continue;
    offset = pos;
    rootfsBytes = used;
    break;
}
if (offset < 0) throw new Error('Aligned SquashFS superblock not found');
const overlayStart = Math.ceil((offset + rootfsBytes) / erase) * erase;
console.log('sysupgrade_bytes=' + image.length);
console.log('firmware_partition_bytes=' + partition);
console.log('squashfs_offset_bytes=' + offset);
console.log('squashfs_bytes_used=' + rootfsBytes);
console.log('rootfs_data_region_bytes=' + (partition - overlayStart));
if (image.length > 12 * 1024 * 1024) throw new Error('Image exceeds 12 MiB release budget');

