import { detectFileType, readImageDimensions, signatureMatchesDeclared } from './file-signature';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n', 'latin1');

describe('detectFileType', () => {
  it('recognises PNG, GIF and PDF from their leading bytes', () => {
    expect(detectFileType(PNG_1X1)).toBe('image/png');
    expect(detectFileType(GIF)).toBe('image/gif');
    expect(detectFileType(PDF)).toBe('application/pdf');
  });

  it('returns null for content it does not recognise', () => {
    expect(detectFileType(Buffer.from('<?php system($_GET[0]); ?>'))).toBeNull();
    expect(detectFileType(Buffer.from('<svg onload="alert(1)"/>'))).toBeNull();
  });
});

describe('signatureMatchesDeclared', () => {
  it('accepts a genuine match', () => {
    expect(signatureMatchesDeclared('image/png', 'image/png')).toBe(true);
  });

  it('rejects a script renamed to .png', () => {
    const payload = Buffer.from('<?php system($_GET[0]); ?>');
    expect(signatureMatchesDeclared(detectFileType(payload), 'image/png')).toBe(false);
  });

  it('rejects a PDF declared as an image', () => {
    expect(signatureMatchesDeclared('application/pdf', 'image/jpeg')).toBe(false);
  });

  it('maps a zip container to the OOXML types it may legitimately be', () => {
    expect(
      signatureMatchesDeclared(
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true);
    expect(signatureMatchesDeclared('application/zip', 'image/png')).toBe(false);
  });
});

describe('readImageDimensions', () => {
  it('reads PNG dimensions', () => {
    expect(readImageDimensions(PNG_1X1, 'image/png')).toEqual({ width: 1, height: 1 });
  });

  it('reads GIF dimensions', () => {
    expect(readImageDimensions(GIF, 'image/gif')).toEqual({ width: 1, height: 1 });
  });

  it('returns null rather than throwing on truncated input', () => {
    expect(readImageDimensions(Buffer.from([0x89, 0x50]), 'image/png')).toBeNull();
  });
});
