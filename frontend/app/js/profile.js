document.addEventListener('DOMContentLoaded', async () => {
  const me = await App.bootstrap('profile');
  if (!me) return;
  const form = document.getElementById('profile-form');
  form.firstName.value = me.profile.firstName;
  form.lastName.value = me.profile.lastName;
  form.country.value = me.profile.country || 'uk';
  form.interests.value = (me.profile.profileInterests || []).join(', ');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      firstName: form.firstName.value,
      lastName: form.lastName.value,
      country: form.country.value,
      profileInterests: form.interests.value.split(',').map((item) => item.trim()).filter(Boolean),
    };
    const result = await App.Api.updateMe(payload);
    form.firstName.value = result.profile.firstName;
    form.lastName.value = result.profile.lastName;
    form.country.value = result.profile.country || 'uk';
    form.interests.value = (result.profile.profileInterests || []).join(', ');
  });
});
